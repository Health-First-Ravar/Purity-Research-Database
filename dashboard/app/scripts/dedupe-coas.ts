// One-time, idempotent cleanup of duplicate / orphan rows in the `coas` table.
//
// Background: an older import-coas matching bug (.maybeSingle() erroring on >1
// match, then falling through to INSERT) let a handful of source files explode
// into hundreds of duplicate shell rows (T7047 x108, 49608 x100, ...). All the
// shells are undated, which is why /reports showed ~265 "no date" when only ~16
// COAs truly lack one. import-coas.ts now self-heals, but the existing pile-up
// needs a one-shot sweep.
//
// Strategy — keep exactly one row per stable key, delete the rest:
//   key = report_number when present, else pdf_filename.
// This preserves the legitimate multi-sample .docx COAs (each sample carries its
// own report_number) while collapsing the shell explosions. Rows with neither a
// report_number NOR a pdf_filename are stale orphans from a pre-source_file
// importer (current import always writes pdf_filename) and are deleted outright.
//
// "Best" row within a group: prefer a populated report_date, then richer analyte
// content, then the most recently created row.
//
// Idempotent: a second run finds nothing to delete. Safe to keep around.
//
// Usage:
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/dedupe-coas.ts --dry
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/dedupe-coas.ts

import { createClient } from '@supabase/supabase-js';

const DRY = process.argv.includes('--dry');
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL/service-role key required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const ANALYTE_COLS = [
  'ota_ppb', 'aflatoxin_ppb', 'acrylamide_ppb', 'cga_mg_g', 'melanoidins_mg_g',
  'trigonelline_mg_g', 'caffeine_pct', 'moisture_pct', 'water_activity',
] as const;

type Row = {
  id: string;
  report_number: string | null;
  pdf_filename: string | null;
  report_date: string | null;
  created_at: string;
  heavy_metals: unknown;
  pesticides_detected: unknown;
  raw_values: Record<string, unknown> | null;
} & Record<string, unknown>;

function richness(r: Row): number {
  let n = 0;
  for (const c of ANALYTE_COLS) if (r[c] != null) n++;
  if (r.heavy_metals) n++;
  if (r.pesticides_detected) n++;
  if (r.raw_values && typeof r.raw_values === 'object') n += Object.keys(r.raw_values).length;
  return n;
}

// Higher is better.
function rank(r: Row): [number, number, number] {
  return [r.report_date ? 1 : 0, richness(r), Date.parse(r.created_at) || 0];
}

function better(a: Row, b: Row): Row {
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i] ? a : b;
  }
  return a;
}

async function fetchAll(): Promise<Row[]> {
  const rows: Row[] = [];
  const select = ['id', 'report_number', 'pdf_filename', 'report_date', 'created_at',
    'heavy_metals', 'pesticides_detected', 'raw_values', ...ANALYTE_COLS].join(',');
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from('coas').select(select).order('id').range(off, off + 999);
    if (error) throw error;
    rows.push(...(data as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const rows = await fetchAll();
  const orphans: string[] = [];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.report_number ? `rn:${r.report_number}` : (r.pdf_filename ? `pf:${r.pdf_filename}` : null);
    if (!key) { orphans.push(r.id); continue; }
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const toDelete: string[] = [...orphans];
  let dupGroups = 0;
  for (const [, grp] of groups) {
    if (grp.length === 1) continue;
    dupGroups++;
    let keep = grp[0];
    for (const r of grp) keep = better(keep, r);
    for (const r of grp) if (r.id !== keep.id) toDelete.push(r.id);
  }

  const kept = rows.length - toDelete.length;
  const keptDated = (() => {
    const del = new Set(toDelete);
    return rows.filter((r) => !del.has(r.id) && r.report_date).length;
  })();
  console.log(`[dedupe-coas] total=${rows.length} orphans(null key)=${orphans.length} duplicate-groups=${dupGroups} to-delete=${toDelete.length}`);
  console.log(`[dedupe-coas] projected: kept=${kept} dated=${keptDated} undated=${kept - keptDated}`);

  if (DRY) { console.log('[dedupe-coas] --dry: no rows deleted'); return; }
  if (toDelete.length === 0) { console.log('[dedupe-coas] nothing to delete'); return; }

  let done = 0;
  for (let i = 0; i < toDelete.length; i += 200) {
    const batch = toDelete.slice(i, i + 200);
    const { error } = await sb.from('coas').delete().in('id', batch);
    if (error) throw error;
    done += batch.length;
  }
  console.log(`[dedupe-coas] deleted ${done} rows`);
}

main().catch((e) => { console.error(e); process.exit(1); });
