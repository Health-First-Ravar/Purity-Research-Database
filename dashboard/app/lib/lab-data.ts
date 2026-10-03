// Server-side loaders and shared view logic for the COA quick view and Home.
// Data comes from lab_results / lab_standard (Brian's tracker, synced). RLS
// already limits customer service to finished products; nothing here widens it.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  analyteStatus, buildStandard, contaminantFail, CORE, display, LABEL, panelState, PRODUCT_ORDER,
  type LabRecord, type Standard, type Status, type StdRow,
} from './lab-status';

export const TRACKER_URL = 'https://claude.ai/artifact/VFhgxKpr4GCMAQ3RiRPBgr';

export type HubRole = 'admin' | 'editor' | 'customer_service' | null;

export async function getHubRole(sb: SupabaseClient): Promise<{ userId: string | null; role: HubRole }> {
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { userId: null, role: null };
  const { data: profile } = await sb.from('profiles').select('role').eq('id', auth.user.id).single();
  const r = profile?.role;
  const role: HubRole =
    r === 'admin' || r === 'editor' || r === 'customer_service' ? r
    : r === 'researcher' ? 'editor'
    : r === 'user' ? 'customer_service'
    : null;
  return { userId: auth.user.id, role };
}

export const isStaffRole = (r: HubRole) => r === 'admin' || r === 'editor';

export type LabData = { recs: LabRecord[]; std: Standard; syncedAt: string | null };

export async function loadLab(sb: SupabaseClient): Promise<LabData> {
  // Paged: PostgREST caps each request (1,000 rows by default), and a silently
  // truncated list would drop the oldest records from every view.
  const page = (from: number) => sb.from('lab_results')
    .select('id, kind, product, name, description, sample_type, status, test_date, lab, analytes, certificate_url, order_number, report_number, sample_number, excluded, excluded_reason, synced_at')
    .order('test_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(from, from + 999);
  const [first, { data: stdRows, error: e2 }] = await Promise.all([page(0), sb.from('lab_standard').select('*')]);
  let error = first.error;
  const rows = [...(first.data ?? [])];
  for (let from = 1000; !error && rows.length === from && from < 20000; from += 1000) {
    const next = await page(from);
    error = next.error;
    rows.push(...(next.data ?? []));
  }
  if (error) throw new Error(`lab_results: ${error.message}`);
  if (e2) throw new Error(`lab_standard: ${e2.message}`);
  const recs = (rows ?? []) as (LabRecord & { synced_at: string })[];
  const syncedAt = recs.reduce<string | null>((m, r) => (!m || r.synced_at > m ? r.synced_at : m), null);
  return { recs, std: buildStandard((stdRows ?? []) as StdRow[]), syncedAt };
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d?: string | null, withYear = true) =>
  d ? `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}${withYear ? `, ${d.slice(0, 4)}` : ''}` : '';

export function monthsAgo(d: string, today: string) {
  return (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / (1000 * 60 * 60 * 24 * 30.44);
}

export const productSlug = (p: string) => p.toLowerCase().replace(/\s+/g, '-');
export const productsWithData = (recs: LabRecord[]) => {
  const s = new Set(recs.filter((r) => r.kind === 'product' && r.product).map((r) => r.product as string));
  return [...PRODUCT_ORDER.filter((p) => s.has(p)), ...[...s].filter((p) => !PRODUCT_ORDER.includes(p)).sort()];
};
export const productFromSlug = (recs: LabRecord[], slug: string) =>
  productsWithData(recs).find((p) => productSlug(p) === decodeURIComponent(slug).toLowerCase()) ?? null;

export type Attention = { sev: 'fail' | 'floor' | 'watch' | 'incon' | 'pending'; title: string; detail: string; href?: string };

/** Brian's "needs attention" list, with minimums (CGA, caffeine) grouped so they don't read as contamination. */
export function attentionItems(recs: LabRecord[], std: Standard, today: string, staff: boolean): Attention[] {
  const scope = recs.filter((r) => staff || r.kind === 'product');
  const items: Attention[] = [];
  for (const r of scope) {
    if (!r.test_date || monthsAgo(r.test_date, today) > 24 || r.status === 'Awaiting sample') continue;
    const bad = Object.keys(r.analytes || {})
      .map((c) => [c, analyteStatus(r, c, std)] as const)
      .filter(([, a]) => a && (a.status === 'fail' || a.status === 'watch') && !a.floor);
    if (!bad.length) continue;
    const sev = bad.some(([, a]) => a!.status === 'fail') ? 'fail' : 'watch';
    items.push({
      sev,
      title: `${r.product || r.name}: ${bad.map(([c, a]) => `${std.finished[c]?.label ?? c} ${display(a!.reading)} ${std.finished[c]?.unit ?? ''}`.trim()).join(', ')}`,
      detail: `${LABEL[sev]} · ${r.lab ?? ''} · ${niceDate(r.test_date)}${r.kind !== 'product' ? ` · ${r.kind === 'green' ? 'green lot' : r.kind}` : ''}`,
      href: r.kind === 'product' && r.product ? `/coa/${productSlug(r.product)}` : '/coa/green',
    });
  }
  const floors = scope.filter((r) => r.test_date && monthsAgo(r.test_date, today) <= 24 && r.status !== 'Awaiting sample'
    && Object.keys(r.analytes || {}).some((c) => analyteStatus(r, c, std)?.floor));
  if (floors.length) {
    items.push({
      sev: 'floor',
      title: `${floors.length} green lots below the chlorogenic acid or caffeine minimum (v2.5)`,
      detail: floors.slice(0, 8).map((r) => {
        const c = Object.keys(r.analytes).find((k) => analyteStatus(r, k, std)?.floor)!;
        return `${r.name} (${c} ${display(analyteStatus(r, c, std)!.reading)}${std.finished[c]?.unit ?? ''})`;
      }).join(' · ') + (floors.length > 8 ? ` · ${floors.length - 8} more` : ''),
      href: '/coa/green',
    });
  }
  const stale = CORE.map((p) => [p, panelState(p, recs, today)] as const).filter(([, s]) => s.status !== 'pass');
  if (stale.length) {
    items.push({
      sev: 'watch',
      title: `Core blends without a current full contaminant panel: ${stale.map(([p]) => p).join(', ')}`,
      detail: stale.map(([p, s]) => `${p}: ${s.full ? `last full panel ${niceDate(s.full.test_date)}` : 'none on file'}`).join(' · '),
      href: '/coa#compliance',
    });
  }
  const pend = scope.filter((r) => r.status === 'Awaiting sample');
  if (pend.length) {
    items.push({
      sev: 'pending',
      title: `${pend.length} samples ordered and awaiting the lab`,
      detail: pend.map((r) => `${r.product || r.name} (${niceDate(r.test_date)})`).join(', '),
    });
  }
  const order = { fail: 0, floor: 1, watch: 2, incon: 3, pending: 4 };
  return items.sort((a, b) => order[a.sev] - order[b.sev]);
}

export const SEV_COLOR: Record<Attention['sev'], string> = {
  fail: '#C0392B', floor: '#B7791F', watch: '#B7791F', incon: '#7A5EA8', pending: '#5F6F6D',
};

export function homeKpis(recs: LabRecord[], std: Standard, today: string, staff: boolean) {
  const scope = recs.filter((r) => staff || r.kind === 'product');
  const current = CORE.filter((p) => panelState(p, recs, today).status === 'pass').length;
  const overLimit = scope.filter((r) => r.test_date && monthsAgo(r.test_date, today) <= 12 && r.status !== 'Awaiting sample' && contaminantFail(r, std)).length;
  const awaiting = scope.filter((r) => r.status === 'Awaiting sample').length;
  const latest = scope.find((r) => r.status !== 'Awaiting sample');
  return { current, overLimit, awaiting, latest };
}

/** Compounds Purity talks about that no panel in Brian's tracker measures yet. */
export const WATCHED_COMPOUNDS: { label: string; codes: string[]; why: string }[] = [
  { label: 'Melanoidins', codes: ['MEL', 'MELANOIDINS'], why: 'A Purity health-compound focus; claims have no internal data' },
  { label: 'N-methylpyridinium (NMP)', codes: ['NMP'], why: 'Already asked about by customers' },
  { label: 'Furan', codes: ['FURAN', 'FUR'], why: 'Roasting process contaminant' },
  { label: 'PAHs', codes: ['PAH', 'BAP', 'PAH4'], why: 'Tested on competitor coffees only' },
];

export function untestedCompounds(recs: LabRecord[]) {
  const present = new Set(recs.flatMap((r) => Object.keys(r.analytes || {}).map((c) => c.toUpperCase())));
  return WATCHED_COMPOUNDS.filter((w) => !w.codes.some((c) => present.has(c)));
}

/** Results where the lab's reporting limit sits above our limit, grouped by analyte. */
export function reportingLimitFlags(recs: LabRecord[], std: Standard, today: string, staff: boolean) {
  const groups = new Map<string, { code: string; count: number; example: string; limit: string }>();
  for (const r of recs) {
    if (!staff && r.kind !== 'product') continue;
    if (!r.test_date || monthsAgo(r.test_date, today) > 24) continue;
    for (const c of Object.keys(r.analytes || {})) {
      const a = analyteStatus(r, c, std);
      if (a?.status !== 'incon') continue;
      const g = r.sample_type === 'green' ? std.green[c] : undefined;
      const lim = g?.value ?? std.finished[c]?.value;
      const entry = groups.get(c) ?? { code: c, count: 0, example: a.reading.raw || display(a.reading), limit: lim != null ? `${lim} ${std.finished[c]?.unit ?? ''}` : '' };
      entry.count++;
      groups.set(c, entry);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export type StatusLike = Status;
