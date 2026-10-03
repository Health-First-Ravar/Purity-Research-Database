// Claims > Check a claim: the claim auditor, opened blank or on a claim from
// Brian's library. Everyone can check. A check of a library claim saves its
// research verdict in the Hub (never in Brian's tracker).

import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { getHubRole, isStaffRole } from '@/lib/lab-data';
import { claimVerdict, isVerdict, VERDICT_CHIP, VERDICT_LABEL } from '@/lib/claim-verdict';
import { Card, claimsSubNav, SubNav } from '../../_components/hub';
import { AuditForm } from '../_components/AuditForm';

export const dynamic = 'force-dynamic';

type AuditRow = {
  id: string; draft_text: string; context: string | null; regulatory_flags: string[]; evidence_tier: number | null;
  compounds_detected: string[]; suggested_rewrite: string | null; created_at: string; verdict: string | null; lab_claim_id: string | null;
};

const CONTEXT_FOR_CHANNEL: Record<string, string> = { 'Product page': 'product_page', Blog: 'newsletter', Packaging: 'product_page' };

export default async function CheckPage({ searchParams }: { searchParams: Promise<{ id?: string; claim?: string }> }) {
  const { id, claim: claimText } = await searchParams;
  const sb = supabaseServer(await cookies());
  const { userId, role } = await getHubRole(sb);
  if (!userId) redirect('/login?next=/claims/check');
  const staff = isStaffRole(role);

  const { data: claim } = id
    ? await sb.from('lab_claims').select('id, claim, channel, risk, evidence_needed, evidence_type, notes').eq('id', id).maybeSingle()
    : { data: null };

  const { data: recentRows } = await sb
    .from('claim_audits')
    .select('id, draft_text, context, regulatory_flags, evidence_tier, compounds_detected, suggested_rewrite, created_at, verdict, lab_claim_id')
    .order('created_at', { ascending: false })
    .limit(10);
  const recent = (recentRows ?? []) as AuditRow[];

  return (
    <div>
      <SubNav items={claimsSubNav} current="/claims/check" />
      <div className="grid gap-4">
        <Card
          title="Check a claim"
          hint="Paste draft wording, or open a claim from the library. Reva runs it through the Compound Reasoning Stack and returns a verdict, any regulatory flags, the evidence tier, and a rewrite that holds up. Health claims stay hedged: may support, associated with, research suggests."
        >
          {claim && (
            <div className="mb-4 rounded-lg bg-purity-soft p-3 text-sm dark:bg-purity-night">
              <div className="text-xs font-semibold uppercase tracking-wider text-purity-muted dark:text-purity-mist">
                Library claim {claim.id}{claim.risk ? ` · Brian's risk: ${claim.risk}` : ''}{claim.channel ? ` · ${claim.channel}` : ''}
              </div>
              {claim.notes && <p className="mt-1 text-purity-muted dark:text-purity-mist">{claim.notes}</p>}
              {claim.evidence_needed && <p className="mt-1"><span className="font-semibold">Evidence needed:</span> {claim.evidence_needed}</p>}
              <p className="mt-1 text-xs text-purity-muted dark:text-purity-mist">
                {staff
                  ? 'Checking this wording unchanged saves the verdict to the claim in the library. Checking an edited version does not.'
                  : 'Your check is saved with your recent checks. Editors and admins set the library verdict.'}
              </p>
            </div>
          )}
          <AuditForm
            initialDraft={claim?.claim ?? (typeof claimText === 'string' ? claimText.slice(0, 4000) : '')}
            initialContext={(claim?.channel && CONTEXT_FOR_CHANNEL[claim.channel]) || 'newsletter'}
            claimId={staff ? claim?.id : undefined}
          />
        </Card>

        <Card title="Recent checks" hint="Yours, or everyone's if you are an editor or admin.">
          {recent.length === 0 ? (
            <p className="text-sm text-purity-muted dark:text-purity-mist">No checks yet.</p>
          ) : (
            <ul className="space-y-3">
              {recent.map((r) => {
                const v = isVerdict(r.verdict) ? r.verdict : claimVerdict(r);
                return (
                  <li key={r.id} className="rounded-lg bg-purity-soft p-3 text-sm dark:bg-purity-night">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-purity-muted dark:text-purity-mist">
                      <span className={`st ${VERDICT_CHIP[v]}`}>{VERDICT_LABEL[v]}</span>
                      <span>{new Date(r.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })}</span>
                      {r.context && <span>· {r.context.replace(/_/g, ' ')}</span>}
                      {r.evidence_tier && <span>· tier {r.evidence_tier}</span>}
                      {r.lab_claim_id && <Link className="underline" href={`/claims?q=${encodeURIComponent(r.lab_claim_id)}`}>· library {r.lab_claim_id}</Link>}
                      {r.regulatory_flags?.map((f) => <span key={f} className="st st-fail">{f.replace(/_/g, ' ')}</span>)}
                    </div>
                    <p className="text-purity-ink dark:text-purity-paper">{r.draft_text}</p>
                    {r.suggested_rewrite && (
                      <p className="mt-2 border-l-2 border-purity-aqua pl-3 text-purity-ink dark:text-purity-paper">
                        <span className="text-xs font-semibold uppercase tracking-wider text-purity-teal dark:text-purity-glow">Rewrite</span><br />
                        {r.suggested_rewrite}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
