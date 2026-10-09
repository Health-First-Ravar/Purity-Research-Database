// Link research library entries to their PDFs in Google Drive.
//
// Research papers are ingested from knowledge-base/research/ text files, which
// pull-new-research.py downloaded from the research Drive folder. Its
// manifest (knowledge-base/research/manifest.json) records each file's Drive
// fileId next to its txt_path, but ingest-kb.ts never copied the fileId onto
// the `sources` row, so 674 library entries said "has PDF" with no way to open
// it. This fills `drive_url` from the manifest, matching sources.path =
// "research/" + txt_path. No Drive API call; nothing else on the row changes.
//
// drive_url ONLY, never drive_file_id: the daily Drive sync (lib/sync.ts)
// finds its rows by drive_file_id. 402 of these files are already in
// `sources` a second time as Drive-synced rows, and for a file it has not
// synced yet the sync would retire a row carrying that id (and delete its
// chunks) on the next run, replacing the curated title, DOI and source_type.
//
// Fills an empty column only (drive_url IS NULL), so it is safe to re-run and
// never overwrites a link someone set. Opening the link still needs access to
// the research folder in Drive.
//
// Usage (from dashboard/app):
//   npx tsx --env-file=.env.local scripts/link-drive-pdfs.ts            # dry run
//   npx tsx --env-file=.env.local scripts/link-drive-pdfs.ts --apply
//   ... --manifest /path/to/manifest.json

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

type ManifestPaper = { fileId?: string; txt_path?: string; drive_url?: string; title?: string };

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const MANIFEST = argv.includes('--manifest')
  ? argv[argv.indexOf('--manifest') + 1]
  : resolve(process.cwd(), '..', '..', 'knowledge-base', 'research', 'manifest.json');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (--env-file=.env.local).'); process.exit(2); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const DRIVE_ID = /^[A-Za-z0-9_-]{20,}$/;

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { papers?: ManifestPaper[] };
  const papers = manifest.papers ?? [];
  const byPath = new Map<string, ManifestPaper>();
  for (const p of papers) {
    if (p.txt_path && p.fileId && DRIVE_ID.test(p.fileId)) byPath.set(`research/${p.txt_path}`, p);
  }

  type Row = { id: string; path: string | null; title: string | null };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('sources').select('id, path, title')
      .eq('kind', 'research_paper').is('valid_until', null).is('drive_url', null).like('path', 'research/%')
      .order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }

  const matches = rows.flatMap((r) => {
    const p = r.path ? byPath.get(r.path) : undefined;
    return p ? [{ id: r.id, drive_url: `https://drive.google.com/file/d/${p.fileId}/view`, title: r.title }] : [];
  });
  const unmatched = rows.filter((r) => !(r.path && byPath.has(r.path)));

  console.log(`[link-drive-pdfs] manifest ${papers.length} papers (${byPath.size} with a Drive id and text path)`);
  console.log(`[link-drive-pdfs] research sources without a Drive link: ${rows.length}; matched ${matches.length}; unmatched ${unmatched.length}`);
  for (const u of unmatched.slice(0, 10)) console.log(`  unmatched: ${u.path}`);
  for (const m of matches.slice(0, 3)) console.log(`  e.g. ${(m.title ?? '').slice(0, 60)} -> ${m.drive_url}`);
  if (!APPLY) { console.log('[link-drive-pdfs] dry run; re-run with --apply to write'); return; }

  let written = 0;
  for (const m of matches) {
    // Guarded on drive_url IS NULL so a concurrent edit is never overwritten.
    const { error, count } = await sb.from('sources')
      .update({ drive_url: m.drive_url }, { count: 'exact' })
      .eq('id', m.id).is('drive_url', null);
    if (error) throw error;
    written += count ?? 0;
  }
  console.log(`[link-drive-pdfs] linked ${written} sources`);
}

main().catch((e) => { console.error('[link-drive-pdfs] failed:', e?.message ?? e); process.exit(1); });
