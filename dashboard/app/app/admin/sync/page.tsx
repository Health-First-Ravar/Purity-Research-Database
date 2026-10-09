// Sync status: every import of Brian's Lab Testing tracker into the Hub, with
// its validation result. The import never writes back to his tracker.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { getHubRole, isStaffRole, niceDate, TRACKER_URL } from '@/lib/lab-data';
import { Card, Kpi, KpiRow } from '../../_components/hub';
import { lastSyncHealth, type SyncRun } from './health';

export const dynamic = 'force-dynamic';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }) + ' ET' : '';

export default async function SyncPage() {
  const sb = supabaseServer(await cookies());
  const { userId, role } = await getHubRole(sb);
  if (!userId) redirect('/login?next=/admin/sync');
  if (!isStaffRole(role)) redirect('/');

  const [{ data, error }, { data: newest }] = await Promise.all([
    sb.from('sync_runs').select('id, snapshot_id, taken_at, imported_at, records, claims, status, detail').order('imported_at', { ascending: false }).limit(30),
    sb.from('lab_results').select('test_date').not('test_date', 'is', null).order('test_date', { ascending: false }).limit(1),
  ]);
  if (error) throw new Error(`sync_runs: ${error.message}`);
  const runs = (data ?? []) as SyncRun[];
  const health = lastSyncHealth(runs);
  // Record counts and details come from the last real import, not a "no change" check.
  const lastImport = runs.find((r) => r.status === 'ok' && !(r.detail as Record<string, unknown> | null)?.unchanged) ?? health.lastOk;
  const d = (lastImport?.detail ?? {}) as Record<string, unknown>;

  return (
    <div className="grid gap-4">
      <KpiRow>
        <Kpi label="Last good run" value={health.lastOk ? niceDate(health.lastOk.imported_at.slice(0, 10), false) : 'None'} sub={`${health.message}${lastImport && lastImport !== health.lastOk ? ` · last change imported ${niceDate(lastImport.imported_at.slice(0, 10), false)}` : ''}`} alert={health.stale} />
        <Kpi label="Records" value={lastImport?.records ?? '—'} sub={`${String(d.excluded ?? 0)} set aside · ${String(d.overrides_applied ?? 0)} reclassified`} />
        <Kpi label="Claims" value={lastImport?.claims ?? '—'} sub="Brian's claim library" />
        <Kpi label="Newest test date" value={newest?.[0]?.test_date ? niceDate(newest[0].test_date, false) : '—'} sub="in the imported data" />
      </KpiRow>

      {health.stale && (
        <div className="hub-attn"><div className="bar" style={{ background: '#B7791F' }} /><div>
          <h3 className="text-[0.95rem] font-semibold">The sync needs a look</h3>
          <p className="text-sm text-purity-muted dark:text-purity-mist">
            {health.lastBad ? `The most recent import was ${health.lastBad.status}. ` : ''}The scheduled task runs on weekdays; more than three days without a good import usually means the Mac was asleep or the task stopped. Check the latest run of the &quot;Purity lab sync&quot; scheduled task.
          </p>
        </div></div>
      )}

      <Card title="How the sync works">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>A Claude scheduled task (&quot;Purity lab sync&quot;, weekdays 9:46 AM and 2:46 PM ET, on Jeremy&apos;s Mac) reads <a className="underline" href={TRACKER_URL} target="_blank" rel="noopener noreferrer">Brian&apos;s tracker</a> and its database. Read only.</li>
          <li>It builds a snapshot with <code>lab-results/build-snapshot.mjs</code>. When nothing changed it skips the import and logs a &quot;no change&quot; check, so every scheduled run that reached the Mac appears below; a missing run shows as a gap.</li>
          <li><code>lab-results/import-local.sh</code> validates the snapshot and imports it into the Hub. Each run is listed below; a rejected snapshot changes nothing.</li>
        </ol>
      </Card>

      <Card title="Sync runs" hint="Newest first, last 30. Imported, no change, or rejected.">
        <div className="hub-table">
          <table>
            <thead><tr><th>Imported</th><th>Status</th><th>Snapshot</th><th>Records</th><th>Claims</th><th>Detail</th></tr></thead>
            <tbody>
              {runs.map((r) => {
                const det = (r.detail ?? {}) as Record<string, unknown>;
                const errs = Array.isArray(det.errors) ? (det.errors as string[]) : [];
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{when(r.imported_at)}</td>
                    <td>
                      {det.unchanged
                        ? <span className="st st-nd">no change</span>
                        : <span className={`st ${r.status === 'ok' ? 'st-pass' : 'st-fail'}`}>{r.status === 'ok' ? 'imported' : r.status}</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs">{r.snapshot_id}<div className="text-purity-muted dark:text-purity-mist">taken {when(r.taken_at)}</div></td>
                    <td className="tabular-nums">{r.records ?? ''}</td>
                    <td className="tabular-nums">{r.claims ?? ''}</td>
                    <td className="text-xs">
                      {errs.length
                        ? errs.slice(0, 3).join('; ')
                        : det.unchanged ? String(det.reason ?? 'no change')
                        : ['excluded', 'overrides_applied', 'deduplicated', 'certificates_matched']
                            .filter((k) => det[k] != null)
                            .map((k) => `${k.replace(/_/g, ' ')}: ${String(det[k])}`)
                            .join(' · ')}
                    </td>
                  </tr>
                );
              })}
              {!runs.length && <tr><td colSpan={6} className="text-sm text-purity-muted">No imports yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
