// Claims: Brian's claim library (every marketing claim found on Purity's
// pages, with his risk rating and the evidence each one needs) beside the
// Hub's research verdict from the claim checker. Read-only with respect to
// Brian's tracker; review status stays off (decision 2026-10-03).

import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { getHubRole, niceDate, TRACKER_URL } from '@/lib/lab-data';
import { isVerdict, VERDICT_CHIP, VERDICT_LABEL, VERDICT_ORDER } from '@/lib/claim-verdict';
import { Card, claimsSubNav, Kpi, KpiRow, SubNav } from '../_components/hub';

export const dynamic = 'force-dynamic';

type Location = { url?: string; title?: string; status?: string; date?: string };
type ClaimRow = {
  id: string; claim: string; category: string | null; channel: string | null; risk: string | null;
  products: string[]; occurrences: number; evidence_needed: string | null; evidence_type: string | null;
  notes: string | null; locations: Location[]; research_verdict: string | null; research_checked_at: string | null;
  synced_at: string;
};

const RISK_CHIP: Record<string, string> = { High: 'st-fail', Medium: 'st-watch', Low: 'st-pass' };
const RISK_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const SHOW = 60;

type SP = { q?: string; risk?: string; cat?: string; ch?: string; prod?: string; v?: string; n?: string };

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sb = supabaseServer(await cookies());
  const { userId } = await getHubRole(sb);
  if (!userId) redirect('/login?next=/claims');

  const { data, error } = await sb
    .from('lab_claims')
    .select('id, claim, category, channel, risk, products, occurrences, evidence_needed, evidence_type, notes, locations, research_verdict, research_checked_at, synced_at');
  if (error) throw new Error(`lab_claims: ${error.message}`);
  const all = (data ?? []) as ClaimRow[];

  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();
  const categories = uniq(all.map((c) => c.category));
  const channels = uniq(all.map((c) => c.channel));
  const products = uniq(all.flatMap((c) => c.products ?? []));

  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = all
    .filter((c) => !q || `${c.id} ${c.claim} ${c.notes ?? ''} ${c.evidence_needed ?? ''}`.toLowerCase().includes(q))
    .filter((c) => !sp.risk || c.risk === sp.risk)
    .filter((c) => !sp.cat || c.category === sp.cat)
    .filter((c) => !sp.ch || c.channel === sp.ch)
    .filter((c) => !sp.prod || (c.products ?? []).includes(sp.prod))
    .filter((c) => !sp.v || (sp.v === 'unchecked' ? !c.research_verdict : c.research_verdict === sp.v))
    .sort((a, b) => (RISK_ORDER[a.risk ?? ''] ?? 9) - (RISK_ORDER[b.risk ?? ''] ?? 9) || b.occurrences - a.occurrences);
  const limit = Math.max(SHOW, Number(sp.n) || SHOW);
  const shown = rows.slice(0, limit);

  const high = all.filter((c) => c.risk === 'High').length;
  const checked = all.filter((c) => c.research_verdict).length;
  const live = all.reduce((n, c) => n + (c.locations ?? []).filter((l) => l.status === 'live').length, 0);
  const syncedAt = all.reduce<string | null>((m, c) => (!m || c.synced_at > m ? c.synced_at : m), null);
  const filtered = Boolean(q || sp.risk || sp.cat || sp.ch || sp.prod || sp.v);
  const moreHref = `/claims?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), n: String(limit + SHOW) })}`;

  return (
    <div>
      <SubNav items={claimsSubNav} current="/claims" />
      <div className="grid gap-4">
        <KpiRow>
          <Kpi label="Claims catalogued" value={all.length} sub="from Brian's audit of Purity's pages" />
          <Kpi label="High risk" value={high} sub="Brian's rating" alert={high > 0} />
          <Kpi label="Live placements" value={live.toLocaleString()} sub="pages where a claim appears" />
          <Kpi label="Research verdicts" value={checked} sub={`of ${all.length} checked in the Hub`} />
        </KpiRow>

        <Card title="Find a claim" hint="Brian rated each claim's risk and listed the evidence it needs. Check any claim to get a research verdict and a compliant rewrite.">
          <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6" method="get">
            <input name="q" defaultValue={sp.q ?? ''} placeholder="Search claim text, notes or id" className="hub-input lg:col-span-2" aria-label="Search claims" />
            <Select name="risk" value={sp.risk} label="Risk" options={['High', 'Medium', 'Low']} />
            <Select name="cat" value={sp.cat} label="Category" options={categories} />
            <Select name="ch" value={sp.ch} label="Channel" options={channels} />
            <Select name="prod" value={sp.prod} label="Product" options={products} />
            <Select name="v" value={sp.v} label="Research verdict" options={['unchecked', ...VERDICT_ORDER]} labels={{ unchecked: 'Not checked yet', ...VERDICT_LABEL }} />
            <div className="flex items-center gap-2 lg:col-span-5">
              <button type="submit" className="hub-btn">Filter</button>
              {filtered && <Link href="/claims" className="text-sm text-purity-muted underline dark:text-purity-mist">Clear</Link>}
              <span className="ml-auto text-sm text-purity-muted dark:text-purity-mist">{rows.length} of {all.length} claims</span>
            </div>
          </form>
        </Card>

        <Card title="Claim library" hint="Highest risk first, then most widespread.">
          <div className="hub-table">
            <table>
              <thead>
                <tr><th>Claim</th><th>Risk</th><th>Where</th><th>Evidence needed</th><th>Research verdict</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} id={c.id}>
                    <td className="min-w-[18rem] max-w-[28rem]">
                      <div className="font-semibold text-purity-ink dark:text-purity-paper">{c.claim}</div>
                      <div className="mt-0.5 text-xs text-purity-muted dark:text-purity-mist">
                        {c.id} · {c.category}{c.products?.length ? ` · ${c.products.slice(0, 4).join(', ')}${c.products.length > 4 ? ` +${c.products.length - 4}` : ''}` : ''}
                      </div>
                      {(c.notes || c.locations?.length > 0) && (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-purity-teal dark:text-purity-glow">Brian&apos;s note and placements</summary>
                          {c.notes && <p className="mt-1 text-purity-muted dark:text-purity-mist">{c.notes}</p>}
                          <ul className="mt-1 space-y-0.5">
                            {(c.locations ?? []).slice(0, 8).map((l, i) => (
                              <li key={i}>
                                {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline">{l.title || l.url}</a> : l.title}
                                {l.status ? ` · ${l.status}` : ''}{l.date ? ` · ${niceDate(l.date)}` : ''}
                              </li>
                            ))}
                            {(c.locations?.length ?? 0) > 8 && <li className="text-purity-muted">{c.locations.length - 8} more in Brian&apos;s tracker</li>}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td>{c.risk ? <span className={`st ${RISK_CHIP[c.risk] ?? 'st-info'}`}>{c.risk}</span> : ''}</td>
                    <td className="whitespace-nowrap text-sm">{c.channel}<div className="text-xs text-purity-muted dark:text-purity-mist">{c.occurrences} page{c.occurrences === 1 ? '' : 's'}</div></td>
                    <td className="max-w-[18rem] text-xs">{c.evidence_type && <div className="font-semibold">{c.evidence_type}</div>}{c.evidence_needed}</td>
                    <td className="whitespace-nowrap">
                      {isVerdict(c.research_verdict)
                        ? <><span className={`st ${VERDICT_CHIP[c.research_verdict]}`}>{VERDICT_LABEL[c.research_verdict]}</span>{c.research_checked_at && <div className="mt-0.5 text-xs text-purity-muted dark:text-purity-mist">{niceDate(c.research_checked_at.slice(0, 10))}</div>}</>
                        : <span className="text-xs text-purity-muted dark:text-purity-mist">Not checked</span>}
                    </td>
                    <td className="whitespace-nowrap"><Link href={`/claims/check?id=${encodeURIComponent(c.id)}`} className="hub-btn-sm">Check</Link></td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={6} className="text-sm text-purity-muted">No claims match.</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length > shown.length && (
            <p className="mt-3 text-sm"><Link href={moreHref} className="underline">Show {Math.min(SHOW, rows.length - shown.length)} more</Link></p>
          )}
        </Card>
      </div>
      <p className="mt-6 text-xs text-purity-muted dark:text-purity-mist">
        The claim library mirrors Brian&apos;s Lab Testing tracker{syncedAt ? `, last synced ${niceDate(syncedAt.slice(0, 10))}` : ''}. Research verdicts are the Hub&apos;s own and never change his tracker.
        {' '}Full records: <a className="underline" href={TRACKER_URL} target="_blank" rel="noopener noreferrer">Brian&apos;s tracker</a>.
      </p>
    </div>
  );
}

function Select({ name, value, label, options, labels }: { name: string; value?: string; label: string; options: string[]; labels?: Record<string, string> }) {
  return (
    <select name={name} defaultValue={value ?? ''} aria-label={label} className="hub-input">
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
    </select>
  );
}
