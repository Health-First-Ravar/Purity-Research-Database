// POST /api/audit — claim check (Bioavailability Gap Detector) for Claims > Check.
// Auth required; everyone may check. Persists to public.claim_audits (RLS scoped
// per user; editor sees all). When an editor or admin checks a library claim's
// own wording (claim_id + unchanged text), the verdict is also saved as that
// claim's research verdict in the Hub.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { auditClaim, AuditUnparseableError, AUDITOR_VERSION, type AuditContext, type ClaimAudit } from '@/lib/rag/audit-claim';
import { checkChatRateLimit } from '@/lib/rate-limit';
import { claimVerdict } from '@/lib/claim-verdict';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

const ALLOWED_CONTEXTS: AuditContext[] = ['newsletter', 'module', 'chat_answer', 'product_page', 'other'];

export async function POST(req: Request) {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { draft?: string; context?: string; claim_id?: string };
  try {
    body = (await req.json()) as { draft?: string; context?: string; claim_id?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const draft = (body.draft ?? '').trim();
  if (draft.length < 12) {
    return NextResponse.json({ error: 'draft_too_short', message: 'Need at least 12 characters.' }, { status: 400 });
  }
  if (draft.length > 4000) {
    return NextResponse.json({ error: 'draft_too_long', message: 'Cap at 4000 characters per audit.' }, { status: 400 });
  }
  const context: AuditContext = ALLOWED_CONTEXTS.includes(body.context as AuditContext)
    ? (body.context as AuditContext)
    : 'other';

  // Reuse the chat rate limit bucket (audit calls Sonnet; same cost shape).
  const rl = await checkChatRateLimit(sb);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: rl.reason, retry_after_seconds: rl.retry_after_seconds },
      { status: 429 },
    );
  }

  const adb = supabaseAdmin();

  // Same draft, same context, same auditor version, last 30 days: return that
  // audit again instead of asking the model. Identical runs used to disagree
  // (evidence tier 3, then 4), which can flip a verdict; a check must be
  // repeatable. A new auditor version or 30 days re-runs it.
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: prior } = await adb
    .from('claim_audits')
    .select('id, audit_json')
    .eq('draft_text', draft)
    .eq('context', context)
    .eq('audit_json->>auditor_version', AUDITOR_VERSION)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // A parse failure must not be stored. auditClaim throws
  // AuditUnparseableError rather than returning an all-false result that would
  // be persisted, and read back later, as a clean audit.
  let audit: ClaimAudit & { reused_from?: string };
  try {
    audit = prior?.audit_json
      ? { ...(prior.audit_json as ClaimAudit), tokens_in: 0, tokens_out: 0, cost_usd: 0, latency_ms: 0, reused_from: prior.id as string }
      : await auditClaim({ draft, context });
  } catch (e) {
    if (e instanceof AuditUnparseableError) {
      return NextResponse.json(
        { error: 'audit_unparseable', message: e.message },
        { status: 502 },
      );
    }
    throw e;
  }

  const verdict = claimVerdict(audit);

  // A check saves a library claim's research verdict only when an editor or
  // admin checks the library wording itself. Anyone may check a rewrite of it,
  // but that result belongs to the rewrite, not to the claim on the site.
  let labClaimId: string | null = null;
  if (typeof body.claim_id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(body.claim_id)) {
    const { data: profile } = await sb.from('profiles').select('role').eq('id', auth.user.id).single();
    if (hasElevatedAccess(profile?.role)) {
      const { data: claim } = await adb.from('lab_claims').select('id, claim').eq('id', body.claim_id).maybeSingle();
      const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
      if (claim && norm(claim.claim) === norm(draft)) labClaimId = claim.id;
    }
  }

  // Persist with admin client so we always insert (RLS still allows
  // self-insert by the user, but the admin path skips the policy round-trip
  // and lets us include user_id explicitly).
  const { data: row, error } = await adb
    .from('claim_audits')
    .insert({
      user_id: auth.user.id,
      draft_text: audit.draft_text,
      context: audit.context,
      compounds_detected: audit.compounds_detected,
      mechanism_engaged: audit.mechanism_engaged,
      bioavailability_engaged: audit.bioavailability_engaged,
      evidence_engaged: audit.evidence_engaged,
      practical_engaged: audit.practical_engaged,
      weakest_link: audit.weakest_link,
      regulatory_flags: audit.regulatory_flags,
      evidence_tier: audit.evidence_tier,
      suggested_rewrite: audit.suggested_rewrite,
      cited_chunk_ids: audit.cited_chunk_ids,
      audit_json: audit,
      tokens_in: audit.tokens_in,
      tokens_out: audit.tokens_out,
      cost_usd: audit.cost_usd,
      latency_ms: audit.latency_ms,
      lab_claim_id: labClaimId,
      verdict,
    })
    .select('id, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'insert_failed', message: error.message, audit }, { status: 500 });
  }

  // The latest check is the claim's research verdict. Only the Hub's own
  // columns are written; Brian's claim fields are never touched here.
  if (labClaimId) {
    const { error: vErr } = await adb
      .from('lab_claims')
      .update({ research_verdict: verdict, research_audit_id: row.id, research_checked_at: row.created_at })
      .eq('id', labClaimId);
    if (vErr) console.error('[audit] saving research verdict failed:', vErr.message);
  }

  return NextResponse.json({
    id: row.id,
    created_at: row.created_at,
    ...audit,
    verdict,
    lab_claim_id: labClaimId,
  });
}
