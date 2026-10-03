// Lab result scoring for the Research Hub.
//
// INTERIM: this is a port of the scoring rules in Brian's Lab Testing tracker
// (evalOne / analyteStatus / recStatus in his page code, copied 2026-10-03).
// The plan is for his tracker to store each record's computed status, at which
// point the Hub displays that and this module only backs the parity check.
// Keep the logic byte-for-byte equivalent to his: a status that differs from
// what customer service sees in his tracker is a bug.

export type Reading = { v?: number | null; q?: string | null; raw?: string | null; rt?: boolean };
export type AnalyteMap = Record<string, Reading[]>;

export type LabRecord = {
  id: string;
  kind: string;
  product: string | null;
  name: string | null;
  description: string | null;
  sample_type: string | null;
  status: string | null;
  test_date: string | null;
  lab: string | null;
  analytes: AnalyteMap;
  certificate_url?: string | null;
  excluded?: boolean | null;
  excluded_reason?: string | null;
  order_number?: string | null;
  report_number?: string | null;
  sample_number?: string | null;
};

export type StdRow = {
  code: string;
  applies_to: 'finished' | 'green';
  label: string;
  unit: string;
  grp: string | null;
  rule: 'ceiling' | 'floor' | 'not_detectable' | 'flag_detected' | 'informational';
  value: number | null;
  required: boolean;
  roasted_only: boolean;
  version?: string;
};

export type Standard = { finished: Record<string, StdRow>; green: Record<string, StdRow> };

export function buildStandard(rows: StdRow[]): Standard {
  const s: Standard = { finished: {}, green: {} };
  for (const r of rows) s[r.applies_to][r.code] = { ...r, value: r.value == null ? null : Number(r.value) };
  return s;
}

export type Status =
  | 'excluded' | 'exempt' | 'info' | 'nd' | 'pass' | 'cleared' | 'detect' | 'incon' | 'watch' | 'fail' | 'pending';

export const RANK: Record<Status, number> = {
  excluded: 0, exempt: 0, info: 0, nd: 1, pass: 2, cleared: 3, detect: 4, incon: 5, watch: 6, fail: 7, pending: 0,
};

export const LABEL: Record<Status, string> = {
  excluded: 'Not scored (set aside)', exempt: 'Not scored (Sacred Cups)', fail: 'Over limit', watch: 'Near limit', incon: 'LOQ above limit',
  detect: 'Detected', cleared: 'Cleared on retest', pass: 'Within limit', nd: 'Not detected', info: 'Info',
  pending: 'Awaiting sample',
};

export const CORE = ['FLOW', 'EASE', 'CALM', 'PROTECT', 'BALANCE'];
export const MATRIX = ['Pb', 'Cd', 'As', 'Hg', 'OTA', 'AFB1', 'ACR', 'GLY', 'YST', 'MLD', 'CGA'];
export const PRODUCT_ORDER = [
  'FLOW', 'EASE', 'CALM', 'PROTECT', 'BALANCE', 'FOUNDERS', 'COLD BREW', 'ESPRESSO', 'GESHA', 'STAR DAY',
  'DECAF', 'DARK ROAST', 'ORIGINAL', 'SACRED CUPS', 'HEARTH',
];

const isLt = (x: Reading) => x.q === '<' || x.q === 'ND';
export const isGreenStd = (r: LabRecord) => r.sample_type === 'green';
export const isDecaf = (r: LabRecord) => /decaf/i.test(r.name || '') && !/before process/i.test(r.name || '');
export const isSacredCups = (r: LabRecord) =>
  r.product === 'SACRED CUPS' || /aponte|sacred ?cups/i.test(`${r.name || ''} ${r.description || ''}`);

export function evalOne(x: Reading | undefined, code: string, rec: LabRecord, std: Standard): Status {
  const d = std.finished[code];
  if (!d || !x) return 'info';
  if (x.q === 'NR') return 'info';
  const v = x.v ?? null;
  const g = isGreenStd(rec) ? std.green[code] : undefined;
  if (g) {
    const lt = isLt(x);
    if (g.rule === 'not_detectable') return lt ? 'nd' : v == null ? 'info' : 'fail';
    if (g.rule === 'ceiling' && g.value != null) {
      if (lt) return v != null && v >= g.value ? 'incon' : 'nd';
      if (v == null) return 'info';
      if (v >= g.value) return 'fail';
      if (v > 0.8 * g.value) return 'watch';
      return 'pass';
    }
    if (g.rule === 'floor' && g.value != null) {
      if (v == null || lt) return 'info';
      if (code === 'CAF' && isDecaf(rec)) return v >= 0.1 ? 'fail' : 'pass';
      // Deliberate in Brian's tracker (see its Standard tab): CGA below 3.0% and caffeine below
      // 0.9% are flagged for review, not failed, because labs report CGA on different bases
      // (as-is vs dry, 5-CQA vs total isomers). Decaf caffeine is the exception above.
      if (v < g.value) return 'watch';
      return 'pass';
    }
  }
  if (d.rule === 'not_detectable') return isLt(x) ? 'nd' : 'fail';
  if (d.rule === 'flag_detected') return isLt(x) || v == null ? 'nd' : 'detect';
  const lim = d.rule === 'ceiling' ? d.value : null;
  if (lim == null) return 'info';
  if (d.roasted_only && rec.sample_type !== 'roasted' && rec.sample_type !== 'brewed') return isLt(x) ? 'nd' : 'info';
  if (isLt(x)) return v != null && v > lim ? 'incon' : 'nd';
  if (v == null) return 'info';
  if (v > lim) return 'fail';
  if (v > 0.8 * lim) return 'watch';
  return 'pass';
}

export type AnalyteResult = { status: Status; reading: Reading; floor: boolean };

export function analyteStatus(rec: LabRecord, code: string, std: Standard): AnalyteResult | null {
  const arr = rec.analytes?.[code];
  if (!arr || !arr.length) return null;
  if (rec.excluded) return { status: 'excluded', reading: arr.filter((x) => !x.rt)[0] || arr[0], floor: false };
  if (isSacredCups(rec)) return { status: 'exempt', reading: arr.filter((x) => !x.rt)[0] || arr[0], floor: false };
  const orig = arr.filter((x) => !x.rt);
  const ret = arr.filter((x) => x.rt);
  const base = orig.length ? orig : arr;
  let worst: Status = 'info';
  let wx = base[0];
  for (const x of base) {
    const s = evalOne(x, code, rec, std);
    if (RANK[s] > RANK[worst]) { worst = s; wx = x; }
  }
  if (worst === 'info') worst = evalOne(base[0], code, rec, std);
  let status = worst;
  if (ret.length && (worst === 'fail' || worst === 'watch')) {
    const rs = ret.map((x) => evalOne(x, code, rec, std));
    if (rs.every((s) => s === 'pass' || s === 'nd')) status = 'cleared';
  }
  const g = isGreenStd(rec) ? std.green[code] : undefined;
  const below = !!g && g.rule === 'floor' && g.value != null && wx?.v != null && wx.v < g.value;
  return { status, reading: wx, floor: below && (status === 'fail' || status === 'watch') };
}

export function recordStatus(rec: LabRecord, std: Standard): Status {
  if (rec.status === 'Awaiting sample') return 'pending';
  if (rec.excluded) return 'excluded';
  if (isSacredCups(rec)) return 'exempt';
  let w: Status = 'info';
  for (const c of Object.keys(rec.analytes || {})) {
    const a = analyteStatus(rec, c, std);
    if (a && RANK[a.status] > RANK[w]) w = a.status;
  }
  return w;
}

/** Label for one analyte result; a missed minimum (CGA, caffeine) is not "over" or "near" a limit. */
export const analyteLabel = (a: AnalyteResult) => (a.floor ? 'Below minimum' : LABEL[a.status]);

export function recordLabel(rec: LabRecord, std: Standard): { status: Status; label: string } {
  const status = recordStatus(rec, std);
  if (status !== 'fail' && status !== 'watch') return { status, label: LABEL[status] };
  const worst = Object.keys(rec.analytes || {})
    .map((c) => analyteStatus(rec, c, std))
    .filter((a): a is AnalyteResult => !!a && a.status === status);
  return { status, label: worst.length && worst.every((a) => a.floor) ? 'Below minimum' : LABEL[status] };
}

/** True when any contaminant (not a minimum like CGA) is over its limit. */
export const contaminantFail = (rec: LabRecord, std: Standard) =>
  Object.keys(rec.analytes || {}).some((c) => {
    const a = analyteStatus(rec, c, std);
    return !!a && a.status === 'fail' && !a.floor;
  });

export function fmt(v: number | null | undefined): string {
  if (v == null) return '';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1).replace(/\.0$/, '');
  if (a >= 1) return v.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
  return v.toPrecision(2);
}

export function display(x: Reading | undefined): string {
  if (!x) return '';
  if (x.q === 'ND') return 'ND';
  if (x.q === 'NR') return 'NR';
  return `${x.q === '<' ? '<' : ''}${fmt(x.v ?? null)}${x.q === 'est' ? ' est' : ''}`;
}

/** A record counts as a full contaminant panel when it carries metals, a mycotoxin and acrylamide. */
export const isFullPanel = (r: LabRecord) =>
  ['Pb', 'Cd', 'As'].some((c) => r.analytes?.[c]) && ['OTA', 'AFB1'].some((c) => r.analytes?.[c]) && !!r.analytes?.ACR;

export function addMonths(isoDate: string, m: number): string {
  const t = new Date(`${isoDate}T00:00:00Z`);
  t.setUTCMonth(t.getUTCMonth() + m);
  return t.toISOString().slice(0, 10);
}

export type PanelState = { status: Status; label: string; full?: LabRecord; due?: string; pending?: LabRecord };

/** SOP check: each blend needs a full contaminant panel every 12 months. `recs` newest first. */
export function panelState(product: string, recs: LabRecord[], today: string): PanelState {
  const mine = recs.filter((r) => r.kind === 'product' && r.product === product);
  const pending = mine.find((r) => r.status === 'Awaiting sample');
  if (product === 'SACRED CUPS') return { status: 'exempt', label: 'Not scored', pending };
  const full = mine.find((r) => r.status !== 'Awaiting sample' && isFullPanel(r));
  if (!full || !full.test_date) return { status: 'fail', label: 'No full panel on file', pending };
  const due = addMonths(full.test_date, 12);
  if (due < today) return { status: 'fail', label: 'Full panel overdue', full, due, pending };
  if (due < addMonths(today, 2)) return { status: 'watch', label: 'Due within 60 days', full, due, pending };
  return { status: 'pass', label: 'Current', full, due, pending };
}

/** Latest finished-product record carrying `code`, from a newest-first list. */
export const latestFor = (recs: LabRecord[], product: string, code: string) =>
  recs.find((r) => r.kind === 'product' && r.product === product && r.status !== 'Awaiting sample' && r.analytes?.[code]);
