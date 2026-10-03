// COA quick view: what needs attention, SOP testing compliance, the latest
// result for every product and analyte, reporting-limit flags and coverage
// gaps. Read-only view of Brian's Lab Testing tracker.

import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { analyteLabel, analyteStatus, CORE, display, latestFor, LABEL, MATRIX, panelState, type Status } from '@/lib/lab-status';
import {
  attentionItems, getHubRole, isStaffRole, loadLab, monthsAgo, niceDate, productsWithData, productSlug,
  reportingLimitFlags, todayISO, untestedCompounds,
} from '@/lib/lab-data';
import { AttentionList, Card, coaSubNav, SubNav, TrackerNote } from '../_components/hub';
import { StatusCell, StatusChip } from '../_components/StatusChip';

export const dynamic = 'force-dynamic';

const SHORT: Record<string, string> = { OTA: 'OTA', AFB1: 'AFB1', CGA: 'CGA', ACR: 'Acrylamide', GLY: 'Glyphosate' };
const LEGEND: Status[] = ['fail', 'watch', 'pass', 'nd', 'incon', 'detect', 'cleared', 'exempt'];

export default async function CoaPage() {
  const sb = supabaseServer(await cookies());
  const { userId, role } = await getHubRole(sb);
  if (!userId) redirect('/login?next=/coa');
  const staff = isStaffRole(role);
  const today = todayISO();
  const { recs, std, syncedAt } = await loadLab(sb);
  const products = productsWithData(recs);
  const items = attentionItems(recs, std, today, staff);
  const loq = reportingLimitFlags(recs, std, today, staff);
  const untested = untestedCompounds(recs);

  // Coverage gaps per core blend: matrix analytes never tested, or last tested over 24 months ago.
  const gaps = CORE.map((p) => {
    const missing: string[] = [];
    const stale: string[] = [];
    for (const c of MATRIX) {
      const r = latestFor(recs, p, c);
      if (!r) missing.push(std.finished[c]?.label ?? c);
      else if (r.test_date && monthsAgo(r.test_date, today) > 24) stale.push(`${std.finished[c]?.label ?? c} (${niceDate(r.test_date)})`);
    }
    return { p, missing, stale };
  }).filter((g) => g.missing.length || g.stale.length);

  return (
    <div>
      <SubNav items={coaSubNav(staff)} current="/coa" />
      <div className="grid gap-4">
        <Card title="Needs attention" hint={`${staff ? 'All samples' : 'Finished products'}, last 24 months.`}>
          <AttentionList items={items} />
        </Card>

        <Card id="compliance" title="Testing compliance" hint="The SOP calls for a full contaminant panel (metals, mycotoxins, acrylamide) on every blend every 12 months.">
          <div className="hub-table">
            <table>
              <thead><tr><th>Product</th><th>Last full panel</th><th>Lab</th><th>Next due</th><th>Status</th><th>In progress</th></tr></thead>
              <tbody>
                {products.map((p) => {
                  const s = panelState(p, recs, today);
                  return (
                    <tr key={p}>
                      <td><Link className="font-semibold text-purity-teal dark:text-purity-glow" href={`/coa/${productSlug(p)}`}>{p}</Link></td>
                      <td className="whitespace-nowrap">{s.full ? niceDate(s.full.test_date) : 'None on file'}</td>
                      <td>{s.full?.lab ?? ''}</td>
                      <td className="whitespace-nowrap">{s.due ? niceDate(s.due) : p === 'SACRED CUPS' ? '' : 'Now'}</td>
                      <td><StatusChip status={s.status} label={s.label} /></td>
                      <td className="text-sm text-purity-muted dark:text-purity-mist">{s.pending ? `Sample ordered ${niceDate(s.pending.test_date)}` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Product by analyte, latest result" hint="Each cell is the most recent result for that product and analyte. Hover for date and lab; click a product for its history.">
          <div className="hub-table">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  {MATRIX.map((c) => (
                    <th key={c}>{SHORT[c] ?? std.finished[c]?.label ?? c}<div className="text-[0.68rem] font-normal normal-case">{std.finished[c]?.unit}</div></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p}>
                    <td><Link className="font-semibold text-purity-teal dark:text-purity-glow" href={`/coa/${productSlug(p)}`}>{p}</Link></td>
                    {MATRIX.map((c) => {
                      const r = latestFor(recs, p, c);
                      const a = r && analyteStatus(r, c, std);
                      if (!r || !a) return <td key={c} className="text-purity-muted">·</td>;
                      return <td key={c}><StatusCell status={a.status} title={`${analyteLabel(a)} · ${niceDate(r.test_date)} · ${r.lab}`}>{display(a.reading)}</StatusCell></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{LEGEND.map((s) => <StatusChip key={s} status={s} />)}</div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Reporting-limit flags" hint="Results where the lab's reporting limit sits above our limit, so a below-limit result cannot be confirmed. Last 24 months.">
            {loq.length ? (
              <div className="hub-table">
                <table>
                  <thead><tr><th>Analyte</th><th>Results</th><th>Lab reported</th><th>Our limit</th></tr></thead>
                  <tbody>
                    {loq.map((g) => (
                      <tr key={g.code}><td>{std.finished[g.code]?.label ?? g.code}</td><td className="tabular-nums">{g.count}</td><td>{g.example}</td><td>{g.limit}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm">None.</p>}
            <p className="mt-2 text-xs text-purity-muted dark:text-purity-mist">Status shown as {LABEL.incon}. Fix: a method with a lower reporting limit.</p>
          </Card>

          <Card title="Coverage gaps" hint="What has not been measured, or not recently.">
            <h3 className="mb-1 text-sm font-semibold">Not on any panel</h3>
            <ul className="mb-3 grid gap-1 text-sm">
              {untested.map((u) => <li key={u.label}><b>{u.label}</b> <span className="text-purity-muted dark:text-purity-mist">· {u.why}</span></li>)}
            </ul>
            {gaps.length > 0 && (
              <>
                <h3 className="mb-1 text-sm font-semibold">Core blends</h3>
                <ul className="grid gap-1 text-sm">
                  {gaps.map((g) => (
                    <li key={g.p}><b>{g.p}</b>{g.missing.length ? <> · never tested: {g.missing.join(', ')}</> : null}{g.stale.length ? <> · older than 24 months: {g.stale.join(', ')}</> : null}</li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      </div>
      <TrackerNote syncedAt={syncedAt} />
    </div>
  );
}
