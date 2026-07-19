// Backfill coas.product_scope.
//
// Requires migration migrations/0002_add_product_scope.sql to have been applied.
//
// Usage:
//   npx tsx scripts/backfill-product-scope.ts            # dry run (default)
//   npx tsx scripts/backfill-product-scope.ts --apply
//
// CLASSIFICATION RULES — deliberately conservative, because this drives a
// customer-facing allowlist and the costly error is calling something ours
// when it is not.
//
//   competitor    a third-party brand appears in coffee_name / pdf_filename /
//                 lot_number. Brand list below is EVIDENCE, not a gate: it
//                 labels what we can prove is someone else's. It is not what
//                 protects customer service — the allowlist is.
//
//   purity        the `blend` column holds a known blend key, OR the SAMPLE
//                 NAME names a blend or one of its aliases from
//                 product-map.json.
//
//   unclassified  everything else.
//
// NOT used as a Purity signal: "Purity" appearing in pdf_filename. Those are
// Purity's own commissioned test reports ("Purity Results Green Coffee
// 1-2018 Crop.pdf") and the coffee inside is frequently a supplier's green lot
// or a third-party product tested for benchmarking. "We paid for this test" is
// not "we sell this coffee", and conflating them would admit competitor rows
// into the customer-service allowlist. This costs recall — many genuine Purity
// green lots land in `unclassified` — which is the correct direction to err.
//
// Env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL / service-role key required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const MAP_PATH = process.env.PRODUCT_MAP ?? resolve(process.cwd(), '..', '..', 'product-map.json');
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as {
  products?: Record<string, { type?: string; aliases?: string[] }>;
};

const BLENDS = Object.entries(map.products ?? {})
  .filter(([, v]) => v?.type === 'blend')
  .map(([k]) => k);
const ALIASES: [string, string][] = [];
for (const [k, v] of Object.entries(map.products ?? {})) {
  for (const a of v?.aliases ?? []) ALIASES.push([a, k]);
}

// Third-party brands seen in the corpus.
//
// Filenames use underscores (JAVA_BURN_COA.pdf, KION_DECAF_COA.pdf) and `_` is
// a word character, so neither `\s*` nor `\b` behaves as you'd expect against
// them — `\bkion\b` does NOT match "KION_DECAF". Normalise separators to
// spaces first (see `normalise`), then plain \b boundaries are reliable.
//
// This list is EVIDENCE for labelling, never the safety mechanism. Two
// separate passes over this corpus each missed a brand; a blocklist cannot be
// trusted to be complete, which is exactly why customer service is gated by
// the `purity` allowlist instead.
const COMPETITOR =
  /\b(bulletproof|lifeboost|java burn|mud wtr|mudwtr|kion|folgers|starbucks|peets?|death wish|kicking horse|maxwell|nescafe|dunkin|caribou|four sigmatic)\b/i;

/** Underscores/hyphens -> spaces so \b works against filename tokens. */
const normalise = (s: string) => s.replace(/[_\-.]+/g, ' ');

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Manual scope decisions, applied before the rules.
 *
 * The pattern rules classify from the sample name, so a record whose name
 * carries no blend or alias falls to `unclassified` however deliberately it was
 * placed. Without this map, re-running the backfill silently demotes an owner
 * decision — the APONTE lots below were set to `purity` by hand and the next
 * run would have put them back, taking three known over-limit results off the
 * customer-service surface without anyone noticing.
 *
 * Keyed by `report_number`. Anything here is authoritative over the rules.
 */
const MANUAL_SCOPE: Record<string, { scope: 'purity' | 'competitor' | 'unclassified'; why: string }> = {
  // Session 5 task 1, owner decision 2026-07-19: our lots, our testing, and the
  // record of an over-limit result belongs in front of CS with the badge rather
  // than hidden behind an unclassified scope.
  'CHG-50217971-0': { scope: 'purity', why: 'manual: APONTE PINK BAG DECAF, OTA 7.3 over the 2 ppb ceiling — owner decision to keep CS-visible' },
  'CHG-50217970-0': { scope: 'purity', why: 'manual: APONTE PINK BAG DECAF, OTA 6.0 over the 2 ppb ceiling — owner decision to keep CS-visible' },
  'CHG-50217786-0': { scope: 'purity', why: 'manual: APONTE GREEN BAG REGULAR, OTA 3.9 over the 2 ppb ceiling — owner decision to keep CS-visible' },
};

type Row = {
  id: string;
  report_number: string | null;
  blend: string | null;
  coffee_name: string | null;
  lot_number: string | null;
  pdf_filename: string | null;
  product_scope?: string | null;
};

function classify(r: Row): { scope: 'purity' | 'competitor' | 'unclassified'; why: string } {
  const manual = r.report_number ? MANUAL_SCOPE[r.report_number.trim()] : undefined;
  if (manual) return manual;

  const brandHay = normalise([r.coffee_name, r.pdf_filename, r.lot_number].filter(Boolean).join(' '));
  const m = brandHay.match(COMPETITOR);
  if (m) return { scope: 'competitor', why: `third-party brand "${m[0]}"` };

  if (r.blend && BLENDS.includes(r.blend)) {
    return { scope: 'purity', why: `blend column = ${r.blend}` };
  }
  const name = r.coffee_name ?? '';
  const b = BLENDS.find((x) => new RegExp(`\\b${x}\\b`, 'i').test(name));
  if (b) return { scope: 'purity', why: `sample name names blend ${b}` };
  const a = ALIASES.find(([al]) => new RegExp(`\\b${esc(al)}\\b`, 'i').test(name));
  if (a) return { scope: 'purity', why: `sample name alias "${a[0]}" -> ${a[1]}` };

  // DELIBERATELY NOT MATCHED: `report_number`.
  //
  // Three records carry a blend name in the report number but have a null
  // sample name, so this function leaves them unclassified:
  //
  //   RESEARCH-2023-01-protect
  //   RESEARCH-2024-10-protect
  //   RESEARCH-2024-10-balance
  //
  // They are genuinely ours, and it is tempting to "fix" the gap by adding
  // report_number as a matching signal. Do not. They are research-sweep
  // analyses of a blend, not the retail-lot QC a customer-service rep is
  // reading the support page for. Surfacing them there would mix research
  // results into a table a rep quotes as production data, and the two are not
  // interchangeable — a research sample is chosen to answer a question, not to
  // represent what shipped.
  //
  // Decision recorded 2026-07-19 (session 5 task 3). If this is ever revisited,
  // the change needed is a separate scope value for research material, not a
  // widening of `purity`.
  return { scope: 'unclassified', why: 'no blend column, no blend/alias in sample name' };
}

async function main() {
  console.log(`allowlist blends: ${BLENDS.join(', ')}`);
  console.log(`aliases: ${ALIASES.map(([a]) => a).join(' | ') || '(none)'}\n`);

  const { data, error } = await sb
    .from('coas')
    .select('id, report_number, blend, coffee_name, lot_number, pdf_filename, product_scope');
  if (error) {
    if (/product_scope/.test(error.message)) {
      console.error(
        'ERROR: coas.product_scope does not exist. Apply ' +
          'migrations/0002_add_product_scope.sql first (needs SUPABASE_DB_URL).',
      );
      process.exit(2);
    }
    throw error;
  }

  const rows = (data ?? []) as Row[];
  const counts = { purity: 0, competitor: 0, unclassified: 0 };
  const changes: { id: string; report_number: string | null; from: string; to: string; why: string }[] = [];

  for (const r of rows) {
    const { scope, why } = classify(r);
    counts[scope] += 1;
    if ((r.product_scope ?? 'unclassified') !== scope) {
      changes.push({ id: r.id, report_number: r.report_number, from: r.product_scope ?? 'unclassified', to: scope, why });
    }
  }

  console.log('=== classification ===');
  for (const k of ['purity', 'competitor', 'unclassified'] as const) {
    console.log(`  ${k.padEnd(14)}${String(counts[k]).padStart(4)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(14)}${String(rows.length).padStart(4)}`);
  console.log(`\n${changes.length} row(s) would change.`);

  console.log('\n=== every competitor ===');
  for (const r of rows) {
    const c = classify(r);
    if (c.scope === 'competitor') {
      console.log(`  ${String(r.report_number).padEnd(18)}| ${String(r.coffee_name).slice(0, 30).padEnd(31)}| ${r.pdf_filename} — ${c.why}`);
    }
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    return;
  }

  let ok = 0, failed = 0;
  for (const c of changes) {
    const { error: e } = await sb.from('coas').update({ product_scope: c.to }).eq('id', c.id);
    if (e) { console.error(`  ${c.report_number}: ${e.message}`); failed += 1; } else ok += 1;
  }
  console.log(`\napplied. updated=${ok} failed=${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
