// Readable titles for research sources: sources.metadata.display.
//
// Source titles come from file names or from a PDF's first lines ("cropley2011",
// "authorea.15003367_v1", "The acute effects ... Shenghui Zhang Affiliated
// Hospital ..., First Published April 5, 2018 Brief Report"), and Ask showed
// them as sources. This fills `metadata.display` = { title, authors, year,
// journal, doi, from } for each active research source:
//   1. Its DOI, or, for a Drive-synced copy (drive_file_id, no DOI), the DOI of
//      its text-ingested twin found through knowledge-base/research/manifest.json
//      (fileId -> txt_path -> sources.path).
//   2. Crossref for that DOI (title, authors, year, journal).
//   3. No DOI or no Crossref record: the twin's extracted title, if any.
// Nothing else on the row changes. Metadata is merged, so ingest-kb and the
// Drive sync keep it. Crossref answers are cached in
// lab-results/latest/crossref-cache.json (gitignored), so re-runs are fast and
// the script can be run in several passes (--max-seconds).
//
// Usage (from dashboard/app):
//   npx tsx --env-file=.env.local scripts/source-display-titles.ts            # dry run
//   npx tsx --env-file=.env.local scripts/source-display-titles.ts --apply
//   ... --max-seconds 150   stop fetching after this long (re-run to continue)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { validDoi } from '../lib/doi';

type Display = { title: string; authors?: string[]; year?: number | null; journal?: string | null; doi?: string | null; from: 'crossref' | 'twin' };
type Src = { id: string; title: string | null; doi: string | null; path: string | null; drive_file_id: string | null; metadata: Record<string, unknown> | null };
type CrossrefHit = { title: string; authors: string[]; year: number | null; journal: string | null } | null;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const MAX_MS = (argv.includes('--max-seconds') ? Number(argv[argv.indexOf('--max-seconds') + 1]) : 600) * 1000;
const ROOT = resolve(process.cwd(), '..', '..');
const MANIFEST = resolve(ROOT, 'knowledge-base', 'research', 'manifest.json');
const CACHE = resolve(ROOT, 'lab-results', 'latest', 'crossref-cache.json');
const MAILTO = 'jravar@puritycoffee.com';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (--env-file=.env.local).'); process.exit(2); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function crossref(doi: string): Promise<CrossrefHit> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${MAILTO}`, { headers: { 'User-Agent': `PurityResearchHub/1.0 (mailto:${MAILTO})` } });
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1500 * (attempt + 1)); // rate limited or a server hiccup: back off and retry
  }
  if (!res) throw new Error('crossref: no response');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`crossref ${res.status}`);
  const m = (await res.json()).message ?? {};
  const title = stripTags(String((m.title ?? [])[0] ?? ''));
  if (!title) return null;
  const parts = m.issued?.['date-parts']?.[0] ?? m.published?.['date-parts']?.[0];
  return {
    title,
    authors: ((m.author ?? []) as { family?: string; name?: string }[]).map((a) => a.family ?? a.name ?? '').filter(Boolean).slice(0, 6),
    year: parts?.[0] ? Number(parts[0]) : null,
    journal: stripTags(String((m['container-title'] ?? [])[0] ?? '')) || null,
  };
}

async function main() {
  const t0 = Date.now();
  const cache: Record<string, CrossrefHit> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  const papers = (JSON.parse(readFileSync(MANIFEST, 'utf8')).papers ?? []) as { fileId?: string; txt_path?: string }[];
  const txtByFile = new Map(papers.filter((p) => p.fileId && p.txt_path).map((p) => [p.fileId!, `research/${p.txt_path}`]));

  const rows: Src[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('sources').select('id, title, doi, path, drive_file_id, metadata')
      .in('kind', ['research_paper', 'coffee_book']).is('valid_until', null).order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Src[]));
    if ((data ?? []).length < 1000) break;
  }
  const byPath = new Map(rows.filter((r) => r.path).map((r) => [r.path!, r]));
  const twinOf = (r: Src) => (r.drive_file_id && txtByFile.has(r.drive_file_id) ? byPath.get(txtByFile.get(r.drive_file_id)!) ?? null : null);
  const doiOf = (r: Src) => validDoi(r.doi) ?? validDoi(twinOf(r)?.doi);

  // Fetch Crossref for DOIs not cached yet, 8 at a time, within the time budget.
  const todo = [...new Set(rows.map(doiOf).filter((d): d is string => !!d).map((d) => d.toLowerCase()))].filter((d) => !(d in cache));
  let fetched = 0, failed = 0;
  const errors: Record<string, number> = {};
  // 3 at a time: Crossref's public pool rate-limits bursts (8 at a time failed with 429s).
  for (let i = 0; i < todo.length && Date.now() - t0 < MAX_MS; i += 3) {
    await Promise.all(todo.slice(i, i + 3).map(async (d) => {
      try { cache[d] = await crossref(d); fetched++; } catch (e) { failed++; const k = e instanceof Error ? e.message : String(e); errors[k] = (errors[k] ?? 0) + 1; }
    }));
  }
  if (failed) console.log('[display-titles] fetch errors:', JSON.stringify(errors));
  writeFileSync(CACHE, JSON.stringify(cache));
  const pending = todo.length - fetched;  // failed ones are retried on the next run

  // Build the display record for each source.
  const updates: { id: string; metadata: Record<string, unknown> }[] = [];
  let viaCrossref = 0, viaTwin = 0, none = 0;
  for (const r of rows) {
    const doi = doiOf(r);
    const hit = doi ? cache[doi.toLowerCase()] : undefined;
    let display: Display | null = null;
    if (hit) { display = { ...hit, doi, from: 'crossref' }; viaCrossref++; }
    else {
      const twin = twinOf(r);
      if (twin?.title && twin.title !== r.title) { display = { title: twin.title, doi: doi ?? null, from: 'twin' }; viaTwin++; }
      else none++;
    }
    if (!display) continue;
    const cur = (r.metadata ?? {}) as Record<string, unknown>;
    if (JSON.stringify(cur.display) === JSON.stringify(display)) continue;
    updates.push({ id: r.id, metadata: { ...cur, display } });
  }

  console.log(`[display-titles] sources ${rows.length}; DOIs to fetch ${todo.length}, fetched ${fetched}, failed ${failed}, still pending ${pending}`);
  console.log(`[display-titles] display from Crossref ${viaCrossref}, from twin ${viaTwin}, none ${none}; rows to update ${updates.length}`);
  for (const u of updates.slice(0, 5)) console.log(`  e.g. ${(u.metadata.display as Display).title.slice(0, 90)}`);
  if (!APPLY) { console.log('[display-titles] dry run; re-run with --apply to write'); return; }
  let written = 0;
  for (let i = 0; i < updates.length; i += 10) {
    await Promise.all(updates.slice(i, i + 10).map(async (u) => {
      const { error } = await sb.from('sources').update({ metadata: u.metadata }).eq('id', u.id);
      if (error) throw error;
      written++;
    }));
  }
  console.log(`[display-titles] wrote ${written}${pending ? `; ${pending} DOIs still to fetch, run again` : ''}`);
}

main().catch((e) => { console.error('[display-titles] failed:', e?.message ?? e); process.exit(1); });
