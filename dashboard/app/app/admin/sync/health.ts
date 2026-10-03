// Health of the Brian-tracker sync, from sync_runs.

export type SyncRun = {
  id: number; snapshot_id: string; taken_at: string | null; imported_at: string;
  records: number | null; claims: number | null; status: 'ok' | 'rejected' | 'failed'; detail: Record<string, unknown> | null;
};

/** The task runs on weekdays; more than three days without a good import means it has stopped. */
const STALE_DAYS = 3;

export function lastSyncHealth(runs: SyncRun[], now = Date.now()) {
  const lastOk = runs.find((r) => r.status === 'ok') ?? null;
  const lastBad = runs[0] && runs[0].status !== 'ok' ? runs[0] : null;
  const ageDays = lastOk ? (now - new Date(lastOk.imported_at).getTime()) / 864e5 : Infinity;
  const stale = ageDays > STALE_DAYS || !!lastBad;
  const message = lastBad
    ? `Last import was ${lastBad.status}`
    : !lastOk ? 'No import yet'
    : ageDays < 1 ? 'Today' : `${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? '' : 's'} ago`;
  return { lastOk, lastBad, stale, message };
}
