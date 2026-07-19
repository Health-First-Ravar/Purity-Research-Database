// Import Processed/*.json COA files into the `coas` table.
// Idempotent — upserts on report_number. Skips VOID records.
//
// Usage:
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-coas.ts
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-coas.ts --processed /path/to/Processed
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROCESSED_ARG = process.argv.indexOf('--processed');
// Resolve Processed/ relative to the repo root so this runs anywhere (local Mac,
// CI runner, Vercel). The importer is launched from dashboard/app, so the repo
// root is two levels up. Override with --processed <path> or PROCESSED_DIR env.
const DEFAULT_PROCESSED =
  process.env.PROCESSED_DIR || resolve(process.cwd(), '..', '..', 'Processed');
const PROCESSED_DIR = PROCESSED_ARG >= 0 ? process.argv[PROCESSED_ARG + 1] : DEFAULT_PROCESSED;
const DRY = process.argv.includes('--dry');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL/service-role key required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

type Analyte = {
  analyte: string;
  panel: string;
  value_normalized: number | null;
  unit_normalized: string | null;
  value_as_reported?: string;
};

type ProcessedCOA = {
  schema_version: number;
  status: string;
  product_key: string | null;
  report_number: string | null;
  sample_id?: string | null;
  test_date: string | null;
  sample_name: string | null;
  lot_or_po: string | null;
  lab: string | null;
  source_file: string | null;
  parse_confidence: number;
  matrix?: string | null;
  analytes: Analyte[];
};

/**
 * Blend keys, read from product-map.json (`products[*].type === 'blend'`).
 *
 * This used to be a hardcoded Set that had drifted from the map: BALANCE and
 * ALZ were absent, so their COAs resolved to a product_key but stored
 * blend=null and vanished from the /reports blend filter. Reading the map means
 * adding a product needs no code change here.
 */
const BLEND_KEYS: Set<string> = (() => {
  const fallback = new Set(['PROTECT', 'FLOW', 'EASE', 'CALM', 'BALANCE', 'ALZ']);
  try {
    const mapPath = process.env.PRODUCT_MAP
      ?? resolve(process.cwd(), '..', '..', 'product-map.json');
    const map = JSON.parse(readFileSync(mapPath, 'utf8')) as {
      products?: Record<string, { type?: string }>;
    };
    const keys = Object.entries(map.products ?? {})
      .filter(([, v]) => v?.type === 'blend')
      .map(([k]) => k);
    if (keys.length) {
      console.log(`[import-coas] blend keys from product-map.json: ${keys.join(', ')}`);
      return new Set(keys);
    }
    console.warn('[import-coas] product-map.json has no blend products; using fallback set');
  } catch (e) {
    console.warn(`[import-coas] could not read product-map.json (${(e as Error).message}); using fallback set`);
  }
  return fallback;
})();

function findAnalyte(analytes: Analyte[], pattern: RegExp): Analyte | undefined {
  return analytes.find((a) => pattern.test(a.analyte));
}

/**
 * A below-LOQ result is not a measurement.
 *
 * When a lab reports "<0.500" the parser stores 0.500 — the reporting
 * threshold — in `value_normalized`. Persisting that as the analyte's numeric
 * asserts a detection that never happened: OTA reported "<1.00" was stored as
 * 1 against a 2 ppb ceiling, reading as half-limit for a clean sample.
 *
 * The numeric column therefore holds only genuine measurements. The threshold
 * itself is preserved in `value_qualifiers` (and in `raw_values.as_reported`),
 * so nothing is lost — "below 1.00" is still recoverable, it is just no longer
 * masquerading as 1.00.
 */
function isBelowLoq(a: Analyte | undefined): boolean {
  return !!a && /^\s*</.test(String(a.value_as_reported ?? ''));
}

function toMgPerG(a: Analyte | undefined): number | null {
  if (!a || a.value_normalized == null) return null;
  if (isBelowLoq(a)) return null;   // threshold, not a measurement
  const unit = (a.unit_normalized ?? '').toLowerCase();
  if (unit === 'mg/g') return a.value_normalized;
  if (unit === 'mg/100g') return a.value_normalized / 100;
  if (unit === 'mcg/g' || unit === 'µg/g' || unit === 'ug/g') return a.value_normalized / 1000;
  if (unit === '%') return a.value_normalized * 10; // % w/w → mg/g (10x)
  return a.value_normalized; // best-effort
}

function toPpb(a: Analyte | undefined): number | null {
  if (!a || a.value_normalized == null) return null;
  if (isBelowLoq(a)) return null;   // threshold, not a measurement
  const unit = (a.unit_normalized ?? '').toLowerCase();
  if (unit === 'ppb' || unit === 'µg/kg' || unit === 'ug/kg') return a.value_normalized;
  if (unit === 'ppm' || unit === 'mg/kg') return a.value_normalized * 1000;
  return a.value_normalized;
}

function toPct(a: Analyte | undefined): number | null {
  if (!a || a.value_normalized == null) return null;
  if (isBelowLoq(a)) return null;   // threshold, not a measurement
  const unit = (a.unit_normalized ?? '').toLowerCase().trim();
  // Accept "%", "% (w/w)", "% w/w", "%(w/w)" — same thing.
  if (/^%(\s*\(?w\/w\)?)?$/.test(unit)) return a.value_normalized;
  // g/100g is dimensionally identical to %.
  if (/^g\s*\/\s*100\s*g$/.test(unit)) return a.value_normalized;
  return null;
}

function extractCoffeeNameFromSample(sample: string | null): string | null {
  if (!sample) return null;
  // Strip trailing "Eurofins Sample: NNNNN" / "Sample: NNNNN" suffix; keep front part.
  let s = sample
    .replace(/\s*(Eurofins\s+)?Sample[:\s#]*\d+\s*$/i, '')
    .trim();
  // If the result is just a code like "PSS-P002593", return null (no real name).
  if (/^[A-Z]{2,4}[-\s]?[\dA-Z]{4,}$/i.test(s)) return null;
  if (/^\d+$/.test(s)) return null;
  return s || null;
}

const ORIGIN_COUNTRIES = [
  'Brazil', 'Colombia', 'Peru', 'Ethiopia', 'Kenya', 'Guatemala', 'Honduras',
  'Costa Rica', 'Nicaragua', 'El Salvador', 'Mexico', 'Indonesia', 'Sumatra',
  'Java', 'Vietnam', 'Uganda', 'Rwanda', 'Burundi', 'Tanzania', 'Yemen',
  'India', 'Papua New Guinea', 'Bolivia', 'Ecuador', 'Panama', 'Jamaica',
  'Haiti', 'Dominican Republic', 'Venezuela', 'Cuba',
];

function cleanLot(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  // Drop obvious parser garbage (very short non-numeric strings).
  if (s.length < 4 && !/^\d+$/.test(s)) return null;
  return s;
}

function extractOrigin(sample: string | null): string | null {
  if (!sample) return null;
  for (const c of ORIGIN_COUNTRIES) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(sample)) return c;
  }
  return null;
}

function mapToCOARow(doc: ProcessedCOA): Record<string, unknown> | null {
  if (doc.status === 'VOID') return null;

  // Guard against fully-null rows: if we have no report_number AND no
  // sample_name AND no analytes, there is nothing useful to store. Inserting
  // such a row creates the empty-row pollution we saw in the `coas` table.
  // Require at least one identifying field OR at least one analyte with a value.
  const hasIdentifier = Boolean(
    (doc.report_number && String(doc.report_number).trim()) ||
    (doc.sample_name && String(doc.sample_name).trim()) ||
    (doc.lot_or_po && String(doc.lot_or_po).trim())
  );
  const hasAnyAnalyteValue = Array.isArray(doc.analytes) && doc.analytes.some(
    (a) => a && a.value_normalized != null
  );
  if (!hasIdentifier && !hasAnyAnalyteValue) {
    return null;
  }

  const A = doc.analytes ?? [];

  // OTA
  const ota = findAnalyte(A, /ochratoxin\s*a\b/i);

  // Aflatoxin — prefer a reported total, else derive from B1+B2+G1+G2.
  //
  // A below-LOQ component is NOT a measurement: the stored numeric is the
  // lab's reporting threshold. Summing four "<0.500" results produced
  // aflatoxin_ppb = 2.0 — a detection that appears nowhere in the source
  // document, against a 4 ppb ceiling, i.e. an apparently half-limit result
  // for a sample where nothing was found.
  //
  // Rule: if EVERY component is below LOQ the derived total is null, with a
  // qualifier carrying the true upper bound (the sum of the component
  // thresholds — four <0.500 components bound the total at <2.00, not
  // <0.500). Never 0, and never the sum of thresholds as if measured.
  const aflaTotal = findAnalyte(A, /aflatoxin\s*total/i)
    ?? findAnalyte(A, /^total\s*aflatoxin/i);
  let afla: Analyte | undefined = aflaTotal;
  let aflaSummed: number | null = null;
  let aflaDerivedQualifier: string | null = null;
  let aflaPartial = false;
  if (!aflaTotal) {
    const parts = ['b1', 'b2', 'g1', 'g2']
      .map((p) => findAnalyte(A, new RegExp(`aflatoxin\\s*${p}\\b`, 'i')))
      .filter((x): x is Analyte => !!x && x.value_normalized != null);
    if (parts.length) {
      const detected = parts.filter((a) => !isBelowLoq(a));
      const below = parts.filter(isBelowLoq);
      afla = parts[0]; // unit reference

      if (detected.length === 0) {
        // Nothing detected. Total is null; bound is the sum of thresholds.
        const bound = below.reduce((s, a) => s + (a.value_normalized ?? 0), 0);
        aflaSummed = null;
        aflaDerivedQualifier = `<${Number(bound.toPrecision(4))}`;
      } else {
        // Mixed. Sum only what was actually measured — adding a threshold for
        // an undetected component would invent signal. The true total lies
        // between this sum and this sum plus the undetected thresholds.
        aflaSummed = detected.reduce((s, a) => s + (a.value_normalized ?? 0), 0);
        aflaPartial = below.length > 0;
      }
    }
  }

  // Acrylamide
  const acrylamide = findAnalyte(A, /acrylamide/i);

  // CGA — prefer "Total Chlorogenic Acid" variants
  const cga = findAnalyte(A, /total\s*chlorogenic\s*acid/i)
    ?? findAnalyte(A, /chlorogenic\s*acid\s*isomers/i);

  // Melanoidins
  const melanoidins = findAnalyte(A, /melanoidin/i);

  // Trigonelline
  const trigonelline = findAnalyte(A, /trigonelline/i);

  // Caffeine — match "Caffeine", "Caffeine Content", "Total Caffeine", "Caffeine (HPLC)"
  const caffeine = findAnalyte(A, /\bcaffeine\b/i);

  // Moisture — match "Moisture", "Moisture Content", "Moisture by KFT"
  const moisture = findAnalyte(A, /\bmoisture\b/i);

  // Water activity
  const waterActivity = findAnalyte(A, /water\s*activity|^aw$/i);

  // Heavy metals → jsonb
  const metals: Record<string, number | null> = {};
  for (const a of A.filter((x) => x.panel === 'heavy_metals')) {
    metals[a.analyte.toLowerCase()] = toPpb(a);
  }

  // All analytes as raw_values catch-all — keep value_as_reported so the UI
  // can render LOQ markers ("<0.500") instead of misleading numerics ("0.5").
  const rawValues: Record<string, unknown> = {};
  for (const a of A) {
    rawValues[a.analyte] = {
      value: a.value_normalized,
      unit: a.unit_normalized,
      panel: a.panel,
      as_reported: a.value_as_reported ?? null,
    };
  }

  // Per-headline qualifier map. Only set when the source value carried a
  // '<' or '>' marker — those are the values where displaying the bare number
  // is materially misleading.
  const qualifiers: Record<string, string> = {};
  function captureQualifier(headlineKey: string, ana: Analyte | undefined) {
    if (!ana?.value_as_reported) return;
    const trimmed = String(ana.value_as_reported).trim();
    if (/^[<>]/.test(trimmed)) qualifiers[headlineKey] = trimmed;
  }
  captureQualifier('ota_ppb',          ota);
  // For a DERIVED total the qualifier is the computed bound above, not the
  // qualifier of whichever component happened to be first — that reported the
  // single-component threshold (<0.500) as if it bounded the four-component
  // total (<2.00).
  if (aflaDerivedQualifier) qualifiers['aflatoxin_ppb'] = aflaDerivedQualifier;
  else if (!aflaPartial) captureQualifier('aflatoxin_ppb', aflaTotal ?? afla);
  captureQualifier('acrylamide_ppb',   acrylamide);
  captureQualifier('cga_mg_g',         cga);
  captureQualifier('melanoidins_mg_g', melanoidins);
  captureQualifier('trigonelline_mg_g',trigonelline);
  captureQualifier('caffeine_pct',     caffeine);
  captureQualifier('moisture_pct',     moisture);
  captureQualifier('water_activity',   waterActivity);
  // Heavy-metal qualifiers as a sub-map
  for (const a of A.filter((x) => x.panel === 'heavy_metals')) {
    if (a.value_as_reported && /^[<>]/.test(String(a.value_as_reported).trim())) {
      qualifiers[`heavy_metals.${a.analyte.toLowerCase()}`] = String(a.value_as_reported).trim();
    }
  }

  // Determine blend from product_key, using product-map.json as the source of
  // truth rather than a second hardcoded list. The hardcoded set had drifted
  // and was missing BALANCE and ALZ, so rows resolved to a product_key but
  // landed with blend=null and disappeared from the /reports blend filter.
  const blend = doc.product_key && BLEND_KEYS.has(doc.product_key) ? doc.product_key : null;

  const pdf_filename = doc.source_file ? doc.source_file.split('/').pop() ?? null : null;

  return {
    report_number: doc.report_number,
    sample_id: doc.sample_id ?? null,
    report_date: doc.test_date ?? null,
    coffee_name: extractCoffeeNameFromSample(doc.sample_name),
    blend,
    lot_number: cleanLot(doc.lot_or_po),
    origin: extractOrigin(doc.sample_name),
    lab: doc.lab ?? null,
    ...(doc.matrix != null ? { matrix: doc.matrix } : {}),
    pdf_filename,
    ota_ppb: toPpb(ota),
    aflatoxin_ppb: aflaSummed ?? toPpb(afla),
    acrylamide_ppb: toPpb(acrylamide),
    cga_mg_g: toMgPerG(cga),
    melanoidins_mg_g: toMgPerG(melanoidins),
    trigonelline_mg_g: toMgPerG(trigonelline),
    caffeine_pct: toPct(caffeine),
    moisture_pct: toPct(moisture),
    water_activity: isBelowLoq(waterActivity) ? null : (waterActivity?.value_normalized ?? null),
    heavy_metals: Object.keys(metals).length ? metals : null,
    raw_values: rawValues,
    value_qualifiers: Object.keys(qualifiers).length ? qualifiers : null,
  };
}

async function main() {
  const files = readdirSync(PROCESSED_DIR).filter((f) => f.endsWith('.json'));
  console.log(`[import-coas] ${files.length} JSON files in ${PROCESSED_DIR}`);

  let inserted = 0, updated = 0, deduped = 0, skipped = 0, errors = 0;

  for (const file of files) {
    const raw = readFileSync(join(PROCESSED_DIR, file), 'utf8');
    let doc: ProcessedCOA;
    try {
      doc = JSON.parse(raw);
    } catch {
      console.warn(`[import-coas] skip ${file} — invalid JSON`);
      skipped++;
      continue;
    }

    const row = mapToCOARow(doc);
    if (!row) {
      skipped++;
      continue;
    }

    if (DRY) {
      console.log(`[dry] ${file} → report=${row.report_number} date=${row.report_date} ota=${row.ota_ppb} cga=${row.cga_mg_g}`);
      continue;
    }

    // Find existing rows by a stable key: report_number when present, else
    // pdf_filename. Select ALL matches rather than .maybeSingle(): once two or
    // more duplicates exist, .maybeSingle() returns an error, the old code read
    // that as data=null, and so INSERTED yet another row — compounding the
    // duplication on every 6-hour sync (e.g. T7047 grew to 108 rows). We now
    // update the first match and delete the rest, so the table self-heals.
    //
    // For null-report_number rows we additionally require report_number IS NULL
    // on the match so a shell parse can never collide with (and clobber) a real
    // dated row that happens to share the same pdf_filename (e.g. 49608.pdf,
    // where one row is the 19-analyte Trilogy parse and the rest are shells).
    let matches: { id: string }[] = [];
    if (row.report_number && row.sample_id) {
      // A report number can cover several samples, so it alone does not
      // identify a COA. Report 3522613-0 covers seven; keying on report_number
      // meant each file matched its siblings and the dedupe below removed
      // them, losing five COAs. Match on the pair.
      const { data } = await sb
        .from('coas')
        .select('id')
        .eq('report_number', row.report_number as string)
        .eq('sample_id', row.sample_id as string)
        .order('created_at', { ascending: true });
      matches = data ?? [];

      // Nothing keyed yet: adopt ONE legacy row for this report that has no
      // sample_id, rather than inserting beside it. Rows imported before
      // migration 0012 have sample_id null, and without this every one of them
      // would gain a duplicate on the first run after the change.
      if (matches.length === 0) {
        const { data: legacy } = await sb
          .from('coas')
          .select('id')
          .eq('report_number', row.report_number as string)
          .is('sample_id', null)
          .order('created_at', { ascending: true })
          .limit(1);
        matches = legacy ?? [];
      }
    } else if (row.report_number) {
      // No sample id on this document (non-Eurofins labs do not print one).
      // Restrict to rows that are themselves unkeyed, so a sample-keyed
      // sibling is never matched or removed by an unkeyed parse.
      const { data } = await sb
        .from('coas')
        .select('id')
        .eq('report_number', row.report_number as string)
        .is('sample_id', null)
        .order('created_at', { ascending: true });
      matches = data ?? [];
    } else if (row.pdf_filename) {
      const { data } = await sb
        .from('coas')
        .select('id')
        .eq('pdf_filename', row.pdf_filename as string)
        .is('report_number', null)
        .order('created_at', { ascending: true });
      matches = data ?? [];
    }

    if (matches.length > 0) {
      const { error } = await sb.from('coas').update(row).eq('id', matches[0].id);
      if (error) { console.error(`[import-coas] update error ${file}:`, error.message); errors++; }
      else updated++;
      if (matches.length > 1) {
        // Soft-retire rather than delete. These are regulated records, and a
        // matching bug that removes rows is unrecoverable — the earlier
        // report_number-only key would have deleted genuinely distinct samples.
        // retired_at hides them from every read surface and is reversible.
        const extra = matches.slice(1).map((m) => m.id);
        const { error: delErr } = await sb
          .from('coas')
          .update({
            retired_at: new Date().toISOString(),
            retired_reason: `duplicate of ${row.report_number ?? row.pdf_filename}` +
              `${row.sample_id ? ` sample ${row.sample_id}` : ''} superseded on import`,
          })
          .in('id', extra);
        if (delErr) console.error(`[import-coas] dedupe retire error ${file}:`, delErr.message);
        else deduped += extra.length;
      }
    } else {
      const { error } = await sb.from('coas').insert(row);
      if (error) { console.error(`[import-coas] insert error ${file}:`, error.message); errors++; }
      else inserted++;
    }
  }

  console.log(`\n[import-coas] done. inserted=${inserted} updated=${updated} deduped=${deduped} skipped=${skipped} errors=${errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
