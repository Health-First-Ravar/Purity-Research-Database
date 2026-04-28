// Import Processed/*.json COA files into the `coas` table.
// Idempotent — upserts on report_number. Skips VOID records.
//
// Usage:
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-coas.ts
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-coas.ts --processed /path/to/Processed
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROCESSED_ARG = process.argv.indexOf('--processed');
const DEFAULT_PROCESSED =
  '/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data/Processed';
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
  test_date: string | null;
  sample_name: string | null;
  lot_or_po: string | null;
  lab: string | null;
  source_file: string | null;
  parse_confidence: number;
  analytes: Analyte[];
};

function findAnalyte(analytes: Analyte[], pattern: RegExp): Analyte | undefined {
  return analytes.find((a) => pattern.test(a.analyte));
}

function toMgPerG(a: Analyte | undefined): number | null {
  if (!a || a.value_normalized == null) return null;
  const unit = (a.unit_normalized ?? '').toLowerCase();
  if (unit === 'mg/g') return a.value_normalized;
  if (unit === 'mg/100g') return a.value_normalized / 100;
  if (unit === 'mcg/g' || unit === 'µg/g' || unit === 'ug/g') return a.value_normalized / 1000;
  if (unit === '%') return a.value_normalized * 10; // % w/w → mg/g (10x)
  return a.value_normalized; // best-effort
}

function toPpb(a: Analyte | undefined): number | null {
  if (!a || a.value_normalized == null) return null;
  const unit = (a.unit_normalized ?? '').toLowerCase();
  if (unit === 'ppb' || unit === 'µg/kg' || unit === 'ug/kg') return a.value_normalized;
  if (unit === 'ppm' || unit === 'mg/kg') return a.value_normalized * 1000;
  return a.value_normalized;
}

function toPct(a: Analyte | undefined): number | null {
  if (!a || a.value_normalized == null) return null;
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

  const A = doc.analytes ?? [];

  // OTA
  const ota = findAnalyte(A, /ochratoxin\s*a\b/i);

  // Aflatoxin — prefer reported total, else sum B1+B2+G1+G2.
  const aflaTotal = findAnalyte(A, /aflatoxin\s*total/i)
    ?? findAnalyte(A, /^total\s*aflatoxin/i);
  let afla: Analyte | undefined = aflaTotal;
  let aflaSummed: number | null = null;
  if (!aflaTotal) {
    const parts = ['b1', 'b2', 'g1', 'g2']
      .map((p) => findAnalyte(A, new RegExp(`aflatoxin\\s*${p}\\b`, 'i')))
      .filter((x): x is Analyte => !!x && x.value_normalized != null);
    if (parts.length) {
      aflaSummed = parts.reduce((s, a) => s + (a.value_normalized ?? 0), 0);
      afla = parts[0]; // for unit reference
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
  captureQualifier('aflatoxin_ppb',    aflaTotal ?? afla);
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

  // Determine blend from product_key
  const BLEND_KEYS = new Set(['PROTECT', 'FLOW', 'EASE', 'CALM']);
  const blend = doc.product_key && BLEND_KEYS.has(doc.product_key) ? doc.product_key : null;

  const pdf_filename = doc.source_file ? doc.source_file.split('/').pop() ?? null : null;

  return {
    report_number: doc.report_number,
    report_date: doc.test_date ?? null,
    coffee_name: extractCoffeeNameFromSample(doc.sample_name),
    blend,
    lot_number: cleanLot(doc.lot_or_po),
    origin: extractOrigin(doc.sample_name),
    lab: doc.lab ?? null,
    pdf_filename,
    ota_ppb: toPpb(ota),
    aflatoxin_ppb: aflaSummed ?? toPpb(afla),
    acrylamide_ppb: toPpb(acrylamide),
    cga_mg_g: toMgPerG(cga),
    melanoidins_mg_g: toMgPerG(melanoidins),
    trigonelline_mg_g: toMgPerG(trigonelline),
    caffeine_pct: toPct(caffeine),
    moisture_pct: toPct(moisture),
    water_activity: waterActivity?.value_normalized ?? null,
    heavy_metals: Object.keys(metals).length ? metals : null,
    raw_values: rawValues,
    value_qualifiers: Object.keys(qualifiers).length ? qualifiers : null,
  };
}

async function main() {
  const files = readdirSync(PROCESSED_DIR).filter((f) => f.endsWith('.json'));
  console.log(`[import-coas] ${files.length} JSON files in ${PROCESSED_DIR}`);

  let inserted = 0, updated = 0, skipped = 0, errors = 0;

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

    // Check if exists
    const { data: existing } = await sb
      .from('coas')
      .select('id')
      .eq('report_number', row.report_number ?? '')
      .maybeSingle();

    if (existing) {
      const { error } = await sb.from('coas').update(row).eq('id', existing.id);
      if (error) { console.error(`[import-coas] update error ${file}:`, error.message); errors++; }
      else updated++;
    } else {
      const { error } = await sb.from('coas').insert(row);
      if (error) { console.error(`[import-coas] insert error ${file}:`, error.message); errors++; }
      else inserted++;
    }
  }

  console.log(`\n[import-coas] done. inserted=${inserted} updated=${updated} skipped=${skipped} errors=${errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
