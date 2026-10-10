// Readable titles for research sources: sources.metadata.display.
//
// Source titles come from file names or from a PDF's first lines ("cropley2011",
// "authorea.15003367_v1", "The acute effects ... Shenghui Zhang Affiliated
// Hospital ..., First Published April 5, 2018 Brief Report"), and Ask showed
// them as sources. This fills `metadata.display` = { title, authors, year,
// journal, doi, from } for each active research source:
//   1. Its DOI, or, for a Drive-synced copy (drive_file_id, no DOI), the DOI of
//      its text-ingested twin found through knowledge-base/research/manifest.json
//      (fileId -> txt_path -> sources.path); Crossref for that DOI.
//   2. Otherwise (research papers): a DOI printed on its first page, kept only
//      when the Crossref title for it appears on that page
//      (lib/source-display-build.ts). The row is stamped display_checked so the
//      page is not read again (--recheck reads it anyway).
//   3. Otherwise: the twin's extracted title, if any.
// The daily Drive sync runs steps 1 and 2 for new rows on its own; this script
// is the backfill.
// Nothing else on the row changes. Metadata is merged, so ingest-kb and the
// Drive sync keep it. Crossref answers are cached in
// lab-results/latest/crossref-cache.json (gitignored), so re-runs are fast and
// the script can be run in several passes (--max-seconds). Set CROSSREF_MAILTO
// to identify requests to Crossref (optional; nothing is sent without it).
//
// Usage (from dashboard/app):
//   npx tsx --env-file=.env.local scripts/source-display-titles.ts            # dry run
//   npx tsx --env-file=.env.local scripts/source-display-titles.ts --apply
//   ... --max-seconds 150   stop fetching after this long (re-run to continue)
//   ... --recheck           read first pages already stamped display_checked

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { validDoi } from '../lib/doi';
import { buildDisplay, crossrefWork, firstPageText, type CrossrefHit, type SourceDisplay } from '../lib/source-display-build';

type Src = { id: string; kind: string; title: string | null; doi: string | null; path: string | null; drive_file_id: string | null; metadata: Record<string, unknown> | null };

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const RECHECK = argv.includes('--recheck');
const MAX_MS = (argv.includes('--max-seconds') ? Number(argv[argv.indexOf('--max-seconds') + 1]) : 600) * 1000;
const ROOT = resolve(process.cwd(), '..', '..');
const MANIFEST = resolve(ROOT, 'knowledge-base', 'research', 'manifest.json');
const CACHE = resolve(ROOT, 'lab-results', 'latest', 'crossref-cache.json');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (--env-file=.env.local).'); process.exit(2); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// jsonb stores object keys in its own order, so compare with keys sorted.
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

async function main() {
  const t0 = Date.now();
  const cache: Record<string, CrossrefHit> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  const cached = async (d: string): Promise<CrossrefHit> => {
    const k = d.toLowerCase();
    if (!(k in cache)) cache[k] = await crossrefWork(d);
    return cache[k];
  };
  const papers = (JSON.parse(readFileSync(MANIFEST, 'utf8')).papers ?? []) as { fileId?: string; txt_path?: string }[];
  const txtByFile = new Map(papers.filter((p) => p.fileId && p.txt_path).map((p) => [p.fileId!, `research/${p.txt_path}`]));

  const rows: Src[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('sources').select('id, kind, title, doi, path, drive_file_id, metadata')
      .in('kind', ['research_paper', 'coffee_book']).is('valid_until', null).order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Src[]));
    if ((data ?? []).length < 1000) break;
  }
  const byPath = new Map(rows.filter((r) => r.path).map((r) => [r.path!, r]));
  const twinOf = (r: Src) => (r.drive_file_id && txtByFile.has(r.drive_file_id) ? byPath.get(txtByFile.get(r.drive_file_id)!) ?? null : null);
  const doiOf = (r: Src) => validDoi(r.doi) ?? validDoi(twinOf(r)?.doi);

  // 1. Crossref for row (or twin) DOIs not cached yet, 3 at a time (8 at a time drew 429s).
  const todo = [...new Set(rows.map(doiOf).filter((d): d is string => !!d).map((d) => d.toLowerCase()))].filter((d) => !(d in cache));
  let fetched = 0, failed = 0;
  const errors: Record<string, number> = {};
  const note = (e: unknown) => { failed++; const k = e instanceof Error ? e.message : String(e); errors[k] = (errors[k] ?? 0) + 1; };
  for (let i = 0; i < todo.length && Date.now() - t0 < MAX_MS; i += 3) {
    await Promise.all(todo.slice(i, i + 3).map(async (d) => { try { await cached(d); fetched++; } catch (e) { note(e); } }));
  }
  const pending = todo.length - fetched;  // failed ones are retried on the next run

  // 2. Display per source: own or twin DOI; else a verified DOI on the first
  //    page (research papers, not yet checked); else the twin's extracted title.
  const today = new Date().toISOString().slice(0, 10);
  const updates: { id: string; metadata: Record<string, unknown> }[] = [];
  const tally = { crossref: 0, page: 0, twin: 0, none: 0, pageSkipped: 0 };
  const queue = [...rows];
  const work = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const cur = (r.metadata ?? {}) as Record<string, unknown>;
      const doi = doiOf(r);
      const hit = doi ? cache[doi.toLowerCase()] : undefined;
      let display: SourceDisplay | null = hit ? { ...hit, doi, from: 'crossref' } : null;
      let checked = false;
      if (!display && r.kind === 'research_paper') {
        if ((cur.display_checked && !RECHECK) || Date.now() - t0 > MAX_MS) tally.pageSkipped++;
        else {
          try {
            display = await buildDisplay({ kind: r.kind, doi: null }, await firstPageText(sb, r.id), cached);
            checked = true;
          } catch (e) { note(e); }
        }
      }
      if (!display) {
        const twin = twinOf(r);
        if (twin?.title && twin.title !== r.title) display = { title: twin.title, doi: doi ?? null, from: 'twin' };
      }
      if (display?.from === 'crossref') tally.crossref++;
      else if (display?.from === 'page-doi') tally.page++;
      else if (display?.from === 'twin') tally.twin++;
      else tally.none++;
      const next = { ...cur, ...(display ? { display } : {}), ...(checked ? { display_checked: today } : {}) };
      if (stable(next) !== stable(cur)) updates.push({ id: r.id, metadata: next });
    }
  };
  await Promise.all([work(), work(), work()]);
  writeFileSync(CACHE, JSON.stringify(cache));

  if (failed) console.log('[display-titles] lookup errors:', JSON.stringify(errors));
  console.log(`[display-titles] sources ${rows.length}; DOIs to fetch ${todo.length}, fetched ${fetched}, still pending ${pending}`);
  console.log(`[display-titles] display from Crossref ${tally.crossref}, from a first-page DOI ${tally.page}, from twin ${tally.twin}, none ${tally.none}; first page not checked ${tally.pageSkipped}; rows to update ${updates.length}`);
  for (const u of updates.filter((x) => (x.metadata.display as SourceDisplay | undefined)?.from === 'page-doi').slice(0, 8)) {
    const d = u.metadata.display as SourceDisplay;
    console.log(`  page DOI ${d.doi}: ${d.title.slice(0, 100)}`);
  }
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
