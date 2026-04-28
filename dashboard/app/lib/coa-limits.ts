// COA limits — strictest publicly published threshold per analyte.
//
// Source of truth: `public.coa_limits` table (admin-editable at /reports/limits).
// The `DEFAULT_LIMITS` array below mirrors the seed data and is used as a
// fallback when the DB fetch fails (e.g. before migration 0020 lands).

import { supabaseAdmin } from './supabase';

export type LimitDirection = 'ceiling' | 'floor' | 'range';

export type Limit = {
  id?: string;
  key: string;
  label: string;
  unit: string;
  category: 'mycotoxin' | 'process_contaminant' | 'heavy_metal' | 'pesticide' | 'quality' | 'bioactive';
  direction: LimitDirection;
  value?: number | null;
  min?: number | null;
  max?: number | null;
  source: string;
  notes?: string | null;
  display_order?: number | null;
  active?: boolean;
};

// Hardcoded fallback. Kept in sync with migration 0020 seed data.
export const DEFAULT_LIMITS: Limit[] = [
  { key: 'ota_ppb',         label: 'Ochratoxin A (OTA)',          unit: 'ppb',   category: 'mycotoxin',           direction: 'ceiling', value: 2,    source: 'CHC Health-Grade Green Standard',  notes: 'Stricter than EU 2023/915 (3 ppb roasted, 5 ppb green) and Brazil ANVISA (10 ppb).' },
  { key: 'aflatoxin_ppb',   label: 'Aflatoxin (total B1+B2+G1+G2)', unit: 'ppb', category: 'mycotoxin',           direction: 'ceiling', value: 4,    source: 'EU 2023/915 (general food)',       notes: 'FDA action level is 20 ppb total.' },
  { key: 'acrylamide_ppb',  label: 'Acrylamide',                  unit: 'ppb',   category: 'process_contaminant', direction: 'ceiling', value: 400,  source: 'EU 2017/2158 benchmark (roasted)', notes: 'Monitoring benchmark, not a legal max.' },
  { key: 'heavy_metals.lead',    label: 'Lead (Pb)',     unit: 'ppb', category: 'heavy_metal', direction: 'ceiling', value: 15, source: 'CHC Health-Grade Green Standard' },
  { key: 'heavy_metals.cadmium', label: 'Cadmium (Cd)',  unit: 'ppb', category: 'heavy_metal', direction: 'ceiling', value: 15, source: 'CHC Health-Grade Green Standard' },
  { key: 'heavy_metals.arsenic', label: 'Arsenic (As, total)', unit: 'ppb', category: 'heavy_metal', direction: 'ceiling', value: 15, source: 'CHC Health-Grade Green Standard' },
  { key: 'heavy_metals.mercury', label: 'Mercury (Hg, total)', unit: 'ppb', category: 'heavy_metal', direction: 'ceiling', value: 1,  source: 'CHC Health-Grade Green Standard' },
  { key: 'moisture_pct',    label: 'Moisture content',            unit: '%',     category: 'quality',             direction: 'range', min: 9.0, max: 11.5, source: 'CHC Health-Grade Green Standard' },
  { key: 'water_activity',  label: 'Water activity (Aw)',         unit: '',      category: 'quality',             direction: 'range', min: 0.50, max: 0.60, source: 'CHC Health-Grade Green Standard' },
  { key: 'caffeine_pct',    label: 'Caffeine (regular green)',    unit: '% DWB', category: 'bioactive',           direction: 'floor', value: 0.9, source: 'CHC Health-Grade Green Standard' },
  { key: 'cga_mg_g',        label: 'Chlorogenic acids (CGAs)',    unit: 'mg/g',  category: 'bioactive',           direction: 'floor', value: 40,  source: 'CHC Health-Grade Green Standard' },
  { key: 'raw:Citric Acid',  label: 'Citric acid', unit: 'mg/g', category: 'bioactive', direction: 'floor', value: 2.0, source: 'CHC Health-Grade Green Standard' },
  { key: 'raw:Malic Acid',   label: 'Malic acid',  unit: 'mg/g', category: 'bioactive', direction: 'floor', value: 1.5, source: 'CHC Health-Grade Green Standard' },
  { key: 'raw:Quinic Acid',  label: 'Quinic acid', unit: 'mg/g', category: 'bioactive', direction: 'floor', value: 3.0, source: 'CHC Health-Grade Green Standard' },
];

// Cached DB load. The cache is module-scoped so within a single server
// process subsequent page renders re-use it. TTL keeps it fresh after edits.
let cache: { limits: Limit[]; expires: number } | null = null;
const TTL_MS = 30_000;

export async function loadLimits(): Promise<Limit[]> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.limits;
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from('coa_limits')
      .select('id, key, label, unit, category, direction, value, min_value, max_value, source, notes, display_order, active')
      .eq('active', true)
      .order('display_order', { ascending: true });
    if (error || !data || data.length === 0) {
      cache = { limits: DEFAULT_LIMITS, expires: now + TTL_MS };
      return DEFAULT_LIMITS;
    }
    const limits: Limit[] = data.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      unit: r.unit ?? '',
      category: r.category as Limit['category'],
      direction: r.direction as LimitDirection,
      value: r.value == null ? null : Number(r.value),
      min:   r.min_value == null ? null : Number(r.min_value),
      max:   r.max_value == null ? null : Number(r.max_value),
      source: r.source,
      notes: r.notes ?? null,
      display_order: r.display_order ?? 0,
      active: !!r.active,
    }));
    cache = { limits, expires: now + TTL_MS };
    return limits;
  } catch {
    return DEFAULT_LIMITS;
  }
}

/** Force the next loadLimits() to re-fetch — call after any admin edit. */
export function bustLimitsCache() { cache = null; }

/** Look up a limit by its key in the supplied list (or fallback to defaults). */
export function getLimit(key: string, limits: Limit[] = DEFAULT_LIMITS): Limit | undefined {
  return limits.find((l) => l.key === key);
}

export type EvalStatus = 'ok' | 'over' | 'under' | 'no_limit' | 'no_value';
export type EvalResult = {
  status: EvalStatus;
  limit?: Limit;
  value?: number | null;
  reported?: string | null;
  belowLoq?: boolean;
};

export function evaluate(args: {
  key: string;
  value: number | null | undefined;
  reported?: string | null;
  limits?: Limit[];
}): EvalResult {
  const limit = getLimit(args.key, args.limits ?? DEFAULT_LIMITS);
  if (!limit) return { status: 'no_limit', value: args.value ?? null, reported: args.reported };
  if (args.value == null) return { status: 'no_value', limit, reported: args.reported };

  const reported = args.reported ?? null;
  const belowLoq = !!reported && /^\s*</.test(reported);

  if (limit.direction === 'ceiling' && limit.value != null) {
    if (belowLoq) return { status: 'ok', limit, value: args.value, reported, belowLoq };
    return {
      status: args.value > limit.value ? 'over' : 'ok',
      limit, value: args.value, reported, belowLoq,
    };
  }

  if (limit.direction === 'floor' && limit.value != null) {
    if (belowLoq) return { status: 'no_value', limit, value: args.value, reported, belowLoq };
    return {
      status: args.value < limit.value ? 'under' : 'ok',
      limit, value: args.value, reported, belowLoq,
    };
  }

  if (limit.direction === 'range' && limit.min != null && limit.max != null) {
    if (args.value > limit.max) return { status: 'over',  limit, value: args.value, reported, belowLoq };
    if (args.value < limit.min) return { status: 'under', limit, value: args.value, reported, belowLoq };
    return { status: 'ok', limit, value: args.value, reported, belowLoq };
  }

  return { status: 'no_limit', limit, value: args.value, reported, belowLoq };
}

export function fmtValue(value: number | null | undefined, reported?: string | null): string {
  if (value == null && !reported) return '—';
  if (reported && /^\s*[<>]/.test(reported)) return reported.trim();
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10)  return value.toFixed(1);
  if (abs >= 1)   return value.toFixed(2);
  if (abs >= 0.1) return value.toFixed(3);
  return value.toPrecision(2);
}

export function statusStyle(status: EvalStatus): string {
  switch (status) {
    case 'over':
    case 'under':    return 'text-purity-rust font-semibold';
    case 'ok':       return 'text-purity-muted dark:text-purity-mist';
    case 'no_limit': return '';
    case 'no_value': return 'text-purity-muted/60 italic dark:text-purity-mist/60';
  }
}

// Backwards-compat: some files import LIMITS as the static array.
export const LIMITS = DEFAULT_LIMITS;
