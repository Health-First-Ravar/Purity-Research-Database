// Turns a snapshot of Brian's tracker into the records his tracker actually
// shows: the same de-duplication and the same overrides (allRecs in his page).

export type BrianReading = { v?: number; q?: string; raw?: string; rt?: boolean };
export type BrianRecord = {
  id: string; kind: string; product?: string | null; name?: string; desc?: string; lab?: string;
  stype?: string; date?: string; status?: string; order?: string; sample?: string; report?: string;
  src?: string; link?: string; excluded?: boolean; excluded_reason?: string;
  r?: Record<string, BrianReading[]>;
};
export type BrianOverride = { kind?: string; product?: string; stype?: string; name?: string };

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Brian's de-duplication key: lab, report (or order), sample, name, date. */
export const dedupeKey = (r: BrianRecord) => [r.lab, r.report || r.order, r.sample, r.name, r.date].map(norm).join('|');

export function trackerView(records: BrianRecord[], overrides: Record<string, BrianOverride> = {}) {
  const seen = new Set<string>();
  const out: (BrianRecord & { original_kind: string })[] = [];
  for (const r of records) {
    const k = dedupeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    const ov = overrides[r.id];
    out.push({ ...r, ...(ov || {}), original_kind: r.kind });
  }
  return out;
}
