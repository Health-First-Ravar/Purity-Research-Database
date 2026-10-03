// One product: SOP status, latest result per analyte with certificate links,
// a facts card for customer questions, full test history, and a printable
// substantiation packet. All from Brian's tracker (synced, read-only).

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { safeHref } from '@/lib/safe-url';
import { analyteLabel, analyteStatus, display, LABEL, MATRIX, panelState, RANK, recordLabel, type LabRecord, type Status } from '@/lib/lab-status';
import { getHubRole, isStaffRole, loadLab, niceDate, productFromSlug, todayISO, TRACKER_URL } from '@/lib/lab-data';
import { Card, coaSubNav, Kpi, KpiRow, SubNav, TrackerNote } from '../../_components/hub';
import { StatusCell, StatusChip } from '../../_components/StatusChip';
import { PrintButton } from '../../_components/PrintButton';

export const dynamic = 'force-dynamic';

const GROUP_ORDER = ['Heavy metals', 'Mycotoxins', 'Process', 'Residues', 'Micro', 'Allergen', 'Health compounds', 'CGA isomers', 'Beverage', 'Per serving', 'Physical'];
const FACTS = ['CAF', 'CGA', 'TRIG', 'SCAF', 'SCGA', 'STRIG', 'BCAF', 'BCGA', 'BTRIG', 'TPC', 'TEAC', 'AGTRON', 'COLOR', 'MOI', 'AW'];

function CertLink({ r }: { r: LabRecord }) {
  const href = safeHref(r.certificate_url);
  return href
    ? <a className="text-purity-teal underline dark:text-purity-glow" href={href} target="_blank" rel="noopener noreferrer">Certificate</a>
    : null;
}

export default async function ProductPage({ params }: { params: Promise<{ product: string }> }) {
  const { product: slug } = await params;
  const sb = supabaseServer(await cookies());
  const { userId, role } = await getHubRole(sb);
  if (!userId) redirect(`/login?next=/coa/${slug}`);
  const staff = isStaffRole(role);
  const today = todayISO();
  const { recs, std, syncedAt } = await loadLab(sb);
  const product = productFromSlug(recs, slug);
  if (!product) notFound();

  const mine = recs.filter((r) => r.kind === 'product' && r.product === product);
  const done = mine.filter((r) => r.status !== 'Awaiting sample');
  const ps = panelState(product, recs, today);

  // Latest record per analyte code for this product.
  const latest = new Map<string, LabRecord>();
  for (const r of done) for (const c of Object.keys(r.analytes || {})) if (!latest.has(c)) latest.set(c, r);
  const codes = [...latest.keys()].filter((c) => std.finished[c]).sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(std.finished[a]?.grp ?? ''), gb = GROUP_ORDER.indexOf(std.finished[b]?.grp ?? '');
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) || a.localeCompare(b);
  });
  let worst: Status = 'info';
  for (const c of MATRIX) { const r = latest.get(c); const a = r && analyteStatus(r, c, std); if (a && RANK[a.status] > RANK[worst]) worst = a.status; }
  const facts = FACTS.filter((c) => latest.has(c));

  return (
    <div>
      <div className="no-print"><SubNav items={coaSubNav(staff)} current="" /></div>
      <div className="grid gap-4">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-purity-teal dark:text-purity-glow">{product}</h1>
              <p className="text-sm text-purity-muted dark:text-purity-mist">Substantiation packet · generated {niceDate(today)} · source: Brian&apos;s Lab Testing tracker</p>
            </div>
            <div className="flex items-center gap-2">
              <a className="no-print text-sm text-purity-teal underline dark:text-purity-glow" href={TRACKER_URL} target="_blank" rel="noopener noreferrer">Open in Brian&apos;s tracker</a>
              <PrintButton label="Print packet" />
            </div>
          </div>
        </Card>

        <KpiRow>
          <Kpi label="Full panel" value={ps.full ? niceDate(ps.full.test_date, false) : 'None'} sub={ps.full ? `${ps.full.lab} · ${ps.full.test_date?.slice(0, 4)}` : 'No full contaminant panel on file'} alert={!ps.full} />
          <Kpi label="Next due" value={ps.due ? niceDate(ps.due, false) : product === 'SACRED CUPS' ? 'Not scored' : 'Now'} sub={ps.label} alert={ps.status === 'fail'} />
          <Kpi label="Tests on file" value={mine.length} sub="All labs, all years" />
          <Kpi label="Worst latest result" value={product === 'SACRED CUPS' ? 'Not scored' : LABEL[worst]} sub="Across the matrix analytes" alert={worst === 'fail'} />
        </KpiRow>

        {facts.length > 0 && (
          <Card title="Product facts" hint="Latest measured values for the questions customers ask most. Only analytes actually tested appear.">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {facts.map((c) => {
                const r = latest.get(c)!; const a = analyteStatus(r, c, std)!;
                return (
                  <div key={c} className="rounded-lg bg-purity-soft p-3 dark:bg-purity-night">
                    <div className="text-xs font-semibold uppercase tracking-wide text-purity-muted dark:text-purity-mist">{std.finished[c]?.label ?? c}</div>
                    <div className="text-lg font-bold tabular-nums">{display(a.reading)} <span className="text-sm font-normal">{std.finished[c]?.unit}</span></div>
                    <div className="text-xs text-purity-muted dark:text-purity-mist">{niceDate(r.test_date)} · {r.lab}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <Card title="Latest result per analyte" hint="One value per analyte from its most recent test, scored against the Health Grade standard.">
          <div className="hub-table">
            <table>
              <thead><tr><th>Analyte</th><th>Group</th><th>Latest</th><th>Status</th><th>Tested</th><th>Certificate</th></tr></thead>
              <tbody>
                {codes.map((c) => {
                  const r = latest.get(c)!; const a = analyteStatus(r, c, std)!;
                  return (
                    <tr key={c}>
                      <td>{std.finished[c]?.label ?? c}</td>
                      <td className="text-sm text-purity-muted dark:text-purity-mist">{std.finished[c]?.grp}</td>
                      <td className="whitespace-nowrap tabular-nums">{display(a.reading)} {std.finished[c]?.unit}</td>
                      <td><StatusChip status={a.status} label={analyteLabel(a)} /></td>
                      <td className="whitespace-nowrap text-sm">{niceDate(r.test_date)} · {r.lab}</td>
                      <td className="text-sm"><CertLink r={r} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-purity-muted dark:text-purity-mist">&quot;&lt;&quot; means below the lab&apos;s reporting limit, not zero. Certificates are shared as whole PDFs only (Eurofins terms).</p>
        </Card>

        <Card title="Test history" hint="Newest first, one row per panel as Brian's tracker records it.">
          <div className="hub-table max-h-[560px]">
            <table>
              <thead><tr><th>Date</th><th>Panel</th><th>Status</th><th>Results</th><th>Certificate</th></tr></thead>
              <tbody>
                {mine.map((r) => {
                  const rl = recordLabel(r, std);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{niceDate(r.test_date)}</td>
                      <td>{r.description || r.name}<div className="text-xs text-purity-muted dark:text-purity-mist">{[r.lab, r.order_number, r.report_number].filter(Boolean).join(' · ')}</div>{r.excluded && <div className="text-xs text-purity-muted dark:text-purity-mist">Not scored: {r.excluded_reason || 'set aside by CERO'}</div>}</td>
                      <td><StatusChip status={rl.status} label={rl.label} /></td>
                      <td className="text-xs">
                        {Object.keys(r.analytes || {}).filter((c) => std.finished[c]).slice(0, 10).map((c) => {
                          const a = analyteStatus(r, c, std)!;
                          return <span key={c} className="m-0.5 inline-block"><StatusCell status={a.status} title={analyteLabel(a)}>{c} {display(a.reading)}</StatusCell></span>;
                        })}
                        {r.status === 'Awaiting sample' && <span className="text-purity-muted">Results pending</span>}
                      </td>
                      <td className="text-sm"><CertLink r={r} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="text-sm no-print"><Link className="text-purity-teal underline dark:text-purity-glow" href="/coa">Back to COA quick view</Link></p>
      </div>
      <TrackerNote syncedAt={syncedAt} />
    </div>
  );
}
