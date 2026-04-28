// Embed every row in `coas` as one chunk so the chat can retrieve lab data.
// One source row of kind='coa' per COA, identified by path = 'coa:<id>'.
// Idempotent — sha256 of the rendered text gates re-embedding.
//
// Usage:
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/embed-coas.ts
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/embed-coas.ts --dry
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { embed } from '../lib/voyage';

const DRY = process.argv.includes('--dry');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL/service-role key required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

type CoaRow = {
  id: string;
  report_number: string | null;
  report_date: string | null;
  blend: string | null;
  coffee_name: string | null;
  lot_number: string | null;
  origin: string | null;
  region: string | null;
  lab: string | null;
  pdf_filename: string | null;
  ota_ppb: number | null;
  aflatoxin_ppb: number | null;
  acrylamide_ppb: number | null;
  cga_mg_g: number | null;
  melanoidins_mg_g: number | null;
  trigonelline_mg_g: number | null;
  caffeine_pct: number | null;
  moisture_pct: number | null;
  water_activity: number | null;
  heavy_metals: Record<string, number | null> | null;
  raw_values: Record<string, { value: number | null; unit: string | null; panel: string | null }> | null;
};

function fmtNum(v: number | null | undefined, unit: string): string {
  if (v == null) return 'not tested';
  // Trim trailing zeros without losing precision for small numbers.
  return `${Number(v.toPrecision(4))} ${unit}`.trim();
}

function renderCoaText(c: CoaRow): { title: string; content: string } {
  const id = c.report_number ?? c.id;
  const titleParts = [
    c.coffee_name ?? c.blend ?? 'Coffee COA',
    c.report_date ? `(${c.report_date})` : null,
    `Report ${id}`,
  ].filter(Boolean);
  const title = titleParts.join(' ');

  const lines: string[] = [];
  lines.push(`Certificate of Analysis — Report ${id}`);
  if (c.report_date) lines.push(`Test date: ${c.report_date}`);
  if (c.blend) lines.push(`Blend: ${c.blend}`);
  if (c.coffee_name) lines.push(`Coffee: ${c.coffee_name}`);
  if (c.origin) lines.push(`Origin: ${c.origin}${c.region ? `, ${c.region}` : ''}`);
  if (c.lot_number) lines.push(`Lot: ${c.lot_number}`);
  if (c.lab) lines.push(`Lab: ${c.lab}`);
  if (c.pdf_filename) lines.push(`Source PDF: ${c.pdf_filename}`);
  lines.push('');

  // Mycotoxins — primary safety concern for green coffee.
  lines.push('Mycotoxins:');
  lines.push(`- Ochratoxin A (OTA): ${fmtNum(c.ota_ppb, 'ppb')}`);
  lines.push(`- Aflatoxin (total B1+B2+G1+G2): ${fmtNum(c.aflatoxin_ppb, 'ppb')}`);
  lines.push('');

  // Process contaminants from roasting.
  lines.push('Process contaminants:');
  lines.push(`- Acrylamide: ${fmtNum(c.acrylamide_ppb, 'ppb')}`);
  lines.push('');

  // Bioactive compounds — health-relevant constituents.
  lines.push('Bioactive compounds:');
  lines.push(`- Chlorogenic acids (CGAs, total): ${fmtNum(c.cga_mg_g, 'mg/g')}`);
  lines.push(`- Melanoidins: ${fmtNum(c.melanoidins_mg_g, 'mg/g')}`);
  lines.push(`- Trigonelline: ${fmtNum(c.trigonelline_mg_g, 'mg/g')}`);
  lines.push('');

  // Composition.
  lines.push('Composition:');
  lines.push(`- Caffeine: ${fmtNum(c.caffeine_pct, '%')}`);
  lines.push(`- Moisture: ${fmtNum(c.moisture_pct, '%')}`);
  lines.push(`- Water activity: ${c.water_activity != null ? Number(c.water_activity.toPrecision(3)) : 'not tested'}`);
  lines.push('');

  // Heavy metals (always in ppb after import-coas normalization).
  if (c.heavy_metals && Object.keys(c.heavy_metals).length > 0) {
    lines.push('Heavy metals (ppb):');
    for (const [name, val] of Object.entries(c.heavy_metals)) {
      lines.push(`- ${name}: ${val == null ? 'not detected' : Number(val.toPrecision(4))}`);
    }
    lines.push('');
  } else {
    lines.push('Heavy metals: not tested on this COA.');
    lines.push('');
  }

  // Other reported analytes from raw_values, deduped against the headlines we already emitted.
  const HEADLINE_KEYS = [
    /ochratoxin\s*a\b/i,
    /aflatoxin/i,
    /acrylamide/i,
    /chlorogenic\s*acid/i,
    /melanoidin/i,
    /trigonelline/i,
    /\bcaffeine\b/i,
    /\bmoisture\b/i,
    /water\s*activity|^aw$/i,
  ];
  const otherEntries: string[] = [];
  for (const [name, v] of Object.entries(c.raw_values ?? {})) {
    if (!v || v.panel === 'heavy_metals') continue;
    if (HEADLINE_KEYS.some((re) => re.test(name))) continue;
    if (v.value == null) continue;
    otherEntries.push(`- ${name}: ${Number(v.value.toPrecision(4))} ${v.unit ?? ''}`.trim());
  }
  if (otherEntries.length) {
    lines.push('Other reported analytes:');
    lines.push(...otherEntries);
  }

  return { title, content: lines.join('\n') };
}

async function upsertSource(args: {
  path: string;
  title: string;
  sha256: string;
  blend: string | null;
  origin: string | null;
  report_date: string | null;
}): Promise<{ id: string; unchanged: boolean }> {
  const { data: existing } = await sb
    .from('sources')
    .select('id, sha256')
    .eq('path', args.path)
    .is('valid_until', null)
    .maybeSingle();

  if (existing && existing.sha256 === args.sha256) {
    return { id: existing.id as string, unchanged: true };
  }
  if (existing) {
    await sb.from('sources').update({ valid_until: new Date().toISOString() }).eq('id', existing.id);
  }

  const { data, error } = await sb
    .from('sources')
    .insert({
      kind: 'coa',
      title: args.title,
      path: args.path,
      sha256: args.sha256,
      freshness_tier: 'weekly',
      metadata: {
        blend: args.blend,
        origin: args.origin,
        report_date: args.report_date,
      },
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string, unchanged: false };
}

async function main() {
  const { data: coas, error } = await sb
    .from('coas')
    .select('id, report_number, report_date, blend, coffee_name, lot_number, origin, region, lab, pdf_filename, ota_ppb, aflatoxin_ppb, acrylamide_ppb, cga_mg_g, melanoidins_mg_g, trigonelline_mg_g, caffeine_pct, moisture_pct, water_activity, heavy_metals, raw_values');
  if (error) throw error;

  const rows = (coas ?? []) as CoaRow[];
  console.log(`[embed-coas] ${rows.length} COA rows`);

  let inserted = 0, unchanged = 0, errors = 0;

  // Build payloads first so we can batch-embed.
  type Payload = { coa: CoaRow; title: string; content: string; sha: string };
  const payloads: Payload[] = rows.map((c) => {
    const { title, content } = renderCoaText(c);
    const sha = createHash('sha256').update(content).digest('hex');
    return { coa: c, title, content, sha };
  });

  if (DRY) {
    console.log(payloads[0]?.content);
    console.log(`\n[dry] would embed ${payloads.length} chunks`);
    return;
  }

  // Step 1: upsert all sources, collect new (changed) ones for embedding.
  const toEmbed: { source_id: string; content: string }[] = [];
  for (const p of payloads) {
    try {
      const path = `coa:${p.coa.id}`;
      const { id: source_id, unchanged: same } = await upsertSource({
        path,
        title: p.title,
        sha256: p.sha,
        blend: p.coa.blend,
        origin: p.coa.origin,
        report_date: p.coa.report_date,
      });
      if (same) {
        unchanged++;
        continue;
      }
      // New or changed — clear old chunks, queue for embedding.
      await sb.from('chunks').delete().eq('source_id', source_id);
      toEmbed.push({ source_id, content: p.content });
    } catch (e) {
      console.error(`[embed-coas] source error coa=${p.coa.id}:`, e);
      errors++;
    }
  }

  console.log(`[embed-coas] ${toEmbed.length} chunks to embed (${unchanged} unchanged)`);

  // Step 2: batch-embed and insert.
  for (let i = 0; i < toEmbed.length; i += 32) {
    const batch = toEmbed.slice(i, i + 32);
    try {
      const vecs = await embed(batch.map((b) => b.content), 'document');
      const chunkRows = batch.map((b, j) => ({
        source_id: b.source_id,
        chunk_index: 0,
        heading: null,
        content: b.content,
        token_count: Math.round(b.content.length / 4),
        embedding: vecs[j] as unknown as string,
      }));
      const { error: insErr } = await sb.from('chunks').insert(chunkRows);
      if (insErr) throw insErr;
      inserted += chunkRows.length;
      process.stdout.write(`.`);
    } catch (e) {
      console.error(`\n[embed-coas] batch error at ${i}:`, e);
      errors += batch.length;
    }
  }

  console.log(`\n[embed-coas] done. inserted=${inserted} unchanged=${unchanged} errors=${errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
