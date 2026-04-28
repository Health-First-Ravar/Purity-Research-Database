// Import the Coffee Research Bibliography xlsx (~448 articles, 447 DOIs)
// into the `sources` table. Idempotent — upserts on DOI when present, falls
// back to (title, year) when DOI is missing.
//
// Usage:
//   tsx scripts/import-bibliography.ts \
//     --file /path/to/Coffee_Research_Bibliography_448_Articles_COMPLETE.xlsx
//
// Env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
// Using the 'xlsx' package — add to deps: npm i -D xlsx
// Lightweight and handles the simple workbook shape we need.
import * as XLSX from 'xlsx';

const DEFAULT_FILE =
  '/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data/knowledge-base/bibliography/Coffee_Research_Bibliography_448_Articles_COMPLETE.xlsx';

const fileArg = process.argv.indexOf('--file');
const FILE = fileArg >= 0 ? process.argv[fileArg + 1] : DEFAULT_FILE;
const DRY  = process.argv.includes('--dry');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL/service-role key required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

type Row = {
  'Name of Article'?: string;
  'Year Published'?: number;
  DOI?: string;
  'Topic/Category'?: string;
  'Where it can be found (Drive Location)'?: string;
  'Where it can be found (Database/Platform)'?: string;
  'Is it free to share?'?: string;
  'Is it free to download?'?: string;
};

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function buildDriveUrlFromDoi(doi: string | null): string | null {
  if (!doi) return null;
  return `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}`;
}

async function main() {
  const buf = readFileSync(FILE);
  const wb  = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null });

  console.log(`[import] ${FILE}`);
  console.log(`[import] ${rows.length} raw rows`);

  let inserted = 0, updated = 0, skipped = 0;

  for (const r of rows) {
    const title = clean(r['Name of Article']);
    if (!title) { skipped++; continue; }

    const doi = clean(r.DOI);
    const year = r['Year Published'] ? Math.round(Number(r['Year Published'])) : null;
    const topic = clean(r['Topic/Category']);
    const driveLoc = clean(r['Where it can be found (Drive Location)']);
    const platform = clean(r['Where it can be found (Database/Platform)']);
    const rightsShare = clean(r['Is it free to share?']);
    const rightsDownload = clean(r['Is it free to download?']);
    const doiUrl = buildDriveUrlFromDoi(doi);

    const payload = {
      kind: 'research_paper' as const,
      title,
      doi,
      year_published: year,
      topic_category: topic,
      drive_location: driveLoc,
      database_platform: platform,
      rights_share: rightsShare,
      rights_download: rightsDownload,
      drive_url: doiUrl,
      freshness_tier: 'stable' as const,
      metadata: {
        source_file: 'Coffee_Research_Bibliography_448_Articles_COMPLETE.xlsx',
        import_batch: new Date().toISOString(),
      },
    };

    if (DRY) { console.log(`[dry] ${title.slice(0, 80)}  doi=${doi ?? '—'}`); continue; }

    // Prefer DOI for dedupe; fall back to (title, year) combo.
    let existingId: string | null = null;
    if (doi) {
      const { data } = await sb
        .from('sources')
        .select('id')
        .eq('doi', doi)
        .is('valid_until', null)
        .maybeSingle();
      existingId = data?.id ?? null;
    } else {
      const { data } = await sb
        .from('sources')
        .select('id')
        .eq('title', title)
        .eq('year_published', year)
        .is('valid_until', null)
        .maybeSingle();
      existingId = data?.id ?? null;
    }

    if (existingId) {
      const { error } = await sb.from('sources').update(payload).eq('id', existingId);
      if (error) throw error;
      updated++;
    } else {
      const { error } = await sb.from('sources').insert(payload);
      if (error) throw error;
      inserted++;
    }
  }

  console.log(`\n[import] done. inserted=${inserted} updated=${updated} skipped=${skipped} total=${rows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
