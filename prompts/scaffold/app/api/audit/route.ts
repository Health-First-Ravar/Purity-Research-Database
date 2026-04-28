// POST /api/audit — Bioavailability Gap Detector endpoint.
// Auth required. Persists to public.claim_audits (RLS scoped per user; editor sees all).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { auditClaim, type AuditContext } from '@/lib/rag/audit-claim';
import { checkChatRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const ALLOWED_CONTEXTS: AuditContext[] = ['newsletter', 'module', 'chat_answer', 'product_page', 'other'];

export async function POST(req: Request) {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { draft?: string; context?: string };
  try {
    body = (await req.json()) as { draft?: string; context?: string };
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
  const rl = await checkChatRateLimit(auth.user.id);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', reason: rl.reason, retry_after_seconds: rl.retry_after_seconds },
      { status: 429 },
    );
  }

  const audit = await auditClaim({ draft, context });

  // Persist with admin client so we always insert (RLS still allows
  // self-insert by the user, but the admin path skips the policy round-trip
  // and lets us include user_id explicitly).
  const adb = supabaseAdmin();
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
    })
    .select('id, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'insert_failed', message: error.message, audit }, { status: 500 });
  }

  return NextResponse.json({
    id: row.id,
    created_at: row.created_at,
    ...audit,
  });
}
