// /audit — Bioavailability Gap Detector UI.
// Server component shell + client form. Recent audits panel below.

import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { AuditForm } from './_components/AuditForm';

export const dynamic = 'force-dynamic';

type AuditRow = {
  id: string;
  draft_text: string;
  context: string | null;
  compounds_detected: string[];
  weakest_link: string | null;
  regulatory_flags: string[];
  evidence_tier: number | null;
  suggested_rewrite: string | null;
  created_at: string;
};

export default async function AuditPage() {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return <p className="text-sm text-purity-muted">Sign in to use the auditor.</p>;

  const { data: recentRows } = await sb
    .from('claim_audits')
    .select('id, draft_text, context, compounds_detected, weakest_link, regulatory_flags, evidence_tier, suggested_rewrite, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const recent: AuditRow[] = recentRows ?? [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-2xl">Claim Auditor</h1>
        <p className="mt-1 max-w-2xl text-sm text-purity-muted dark:text-purity-mist">
          Paste a draft sentence or paragraph. Reva runs it through the Compound Reasoning Stack
          (mechanism / bioavailability / evidence / practical) and returns the weakest link, any
          regulatory flags, the evidence tier, and a reconstructed claim that holds up.
        </p>
      </header>

      <AuditForm />

      <section>
        <h2 className="mb-3 font-serif text-lg">Recent audits</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-purity-muted dark:text-purity-mist">
            No audits yet. Try the form above with a draft you are working on.
          </p>
        ) : (
          <ul className="space-y-3">
            {recent.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-purity-muted dark:text-purity-mist">
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                  {r.context && <Tag>{r.context}</Tag>}
                  {r.evidence_tier && <Tag>tier {r.evidence_tier}</Tag>}
                  {r.weakest_link && <Tag tone="warn">weakest: {r.weakest_link}</Tag>}
                  {r.regulatory_flags?.map((f) => (
                    <Tag key={f} tone="rust">{f.replace(/_/g, ' ')}</Tag>
                  ))}
                  {r.compounds_detected?.map((c) => (
                    <Tag key={c} tone="aqua">{c}</Tag>
                  ))}
                </div>
                <p className="mt-2 text-purity-bean dark:text-purity-paper">{r.draft_text}</p>
                {r.suggested_rewrite && (
                  <div className="mt-3 rounded-md border border-purity-green/30 bg-purity-green/5 p-3 dark:border-purity-aqua/30 dark:bg-purity-aqua/10">
                    <div className="mb-1 text-xs uppercase tracking-wide text-purity-green dark:text-purity-aqua">
                      Suggested rewrite
                    </div>
                    <p className="text-purity-bean dark:text-purity-paper">{r.suggested_rewrite}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tag({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'aqua' | 'warn' | 'rust';
}) {
  const cls =
    tone === 'aqua'
      ? 'bg-purity-aqua/15 text-purity-green dark:text-purity-aqua'
      : tone === 'warn'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        : tone === 'rust'
          ? 'bg-purity-rust/15 text-purity-rust'
          : 'bg-purity-bean/10 text-purity-muted dark:bg-purity-paper/10 dark:text-purity-mist';
  return <span className={`inline-block rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>{children}</span>;
}
