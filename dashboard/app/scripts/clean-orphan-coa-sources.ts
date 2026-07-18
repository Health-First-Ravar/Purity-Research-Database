// Identify (and, only when explicitly told to, remove) orphaned COA sources.
//
// A `sources` row with kind='coa' carries path = 'coa:<uuid>' pointing at the
// `coas` row it was rendered from. When that COA row is deleted the source and
// its chunks survive, so retrieval can still surface a report that no longer
// exists — including reports that were deleted precisely because they were
// wrong or misclassified.
//
// Usage:
//   npx tsx scripts/clean-orphan-coa-sources.ts              # dry run (default)
//   npx tsx scripts/clean-orphan-coa-sources.ts --sample 25  # show more examples
//   npx tsx scripts/clean-orphan-coa-sources.ts --json out.json
//   npx tsx scripts/clean-orphan-coa-sources.ts --delete --yes-i-am-sure
//
// SAFETY
//   - Dry run is the default. Deleting requires BOTH --delete and
//     --yes-i-am-sure; either alone aborts.
//   - Deletion retires rather than destroys: sources.valid_until is stamped and
//     the dependent chunks are removed, so retrieval stops surfacing them while
//     the provenance row remains. Nothing is hard-deleted from `sources`.
//   - A retired source is restored by clearing valid_until and re-running
//     `npm run embed-coas`.
//
// Env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2);
const DELETE = argv.includes('--delete');
const CONFIRMED = argv.includes('--yes-i-am-sure');
const SAMPLE = (() => {
  const i = argv.indexOf('--sample');
  return i >= 0 ? Math.max(1, Number(argv[i + 1]) || 10) : 10;
})();
const JSON_OUT = (() => {
  const i = argv.indexOf('--json');
  return i >= 0 ? argv[i + 1] : null;
})();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL / service-role key required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

type SourceRow = {
  id: string;
  title: string | null;
  path: string | null;
  created_at: string;
  valid_until: string | null;
};

async function main() {
  if (DELETE && !CONFIRMED) {
    console.error(
      'REFUSING: --delete requires --yes-i-am-sure as well.\n' +
        'Run without flags first and read the dry-run report.',
    );
    process.exit(2);
  }

  // Every coa source, retired or not.
  const { data: sources, error: srcErr } = await sb
    .from('sources')
    .select('id, title, path, created_at, valid_until')
    .eq('kind', 'coa');
  if (srcErr) throw srcErr;

  // Every live COA id.
  const { data: coas, error: coaErr } = await sb.from('coas').select('id');
  if (coaErr) throw coaErr;
  const live = new Set((coas ?? []).map((r) => r.id as string));

  const rows = (sources ?? []) as SourceRow[];
  const orphans: SourceRow[] = [];
  const malformed: SourceRow[] = [];
  let resolved = 0;

  for (const s of rows) {
    const p = s.path ?? '';
    if (!p.startsWith('coa:')) { malformed.push(s); continue; }
    const id = p.slice(4);
    if (live.has(id)) resolved += 1;
    else orphans.push(s);
  }

  const active = orphans.filter((o) => o.valid_until == null);
  const retired = orphans.filter((o) => o.valid_until != null);

  // How many chunks hang off the orphans — the actual retrieval exposure.
  let orphanChunks = 0;
  for (let i = 0; i < active.length; i += 50) {
    const { count, error } = await sb
      .from('chunks')
      .select('*', { count: 'exact', head: true })
      .in('source_id', active.slice(i, i + 50).map((o) => o.id));
    if (error) throw error;
    orphanChunks += count ?? 0;
  }

  console.log('=== Orphaned COA sources ===');
  console.log(`  kind='coa' sources      : ${rows.length}`);
  console.log(`    resolve to a coas row : ${resolved}`);
  console.log(`    ORPHANED              : ${orphans.length}`);
  console.log(`      still active        : ${active.length}   <- retrievable today`);
  console.log(`      already retired     : ${retired.length}`);
  console.log(`    malformed path        : ${malformed.length}`);
  console.log(`  chunks on active orphans: ${orphanChunks}`);

  console.log(`\n=== Sample of ${Math.min(SAMPLE, active.length)} active orphans ===`);
  for (const o of active.slice(0, SAMPLE)) {
    console.log(`  ${o.id.slice(0, 8)}  ${o.created_at.slice(0, 10)}  ${(o.title ?? '(untitled)').slice(0, 64)}`);
    console.log(`            -> ${o.path}  (no such coas row)`);
  }

  if (malformed.length) {
    console.log(`\n=== Malformed paths (NOT treated as orphans, left alone) ===`);
    for (const m of malformed.slice(0, 5)) {
      console.log(`  ${m.id.slice(0, 8)}  path=${JSON.stringify(m.path)}  ${(m.title ?? '').slice(0, 48)}`);
    }
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ active, retired, malformed }, null, 2));
    console.log(`\nwrote ${JSON_OUT}`);
  }

  if (!DELETE) {
    console.log('\nDRY RUN — nothing was modified.');
    console.log('To retire these after review:');
    console.log('  npx tsx scripts/clean-orphan-coa-sources.ts --delete --yes-i-am-sure');
    return;
  }

  console.log(`\nRetiring ${active.length} orphaned sources and deleting their chunks...`);
  const stamp = new Date().toISOString();
  let retiredCount = 0, chunksDeleted = 0;
  for (const o of active) {
    const { count, error: delErr } = await sb
      .from('chunks').delete({ count: 'exact' }).eq('source_id', o.id);
    if (delErr) { console.error(`  chunk delete failed for ${o.id}: ${delErr.message}`); continue; }
    chunksDeleted += count ?? 0;
    const { error: updErr } = await sb
      .from('sources').update({ valid_until: stamp }).eq('id', o.id);
    if (updErr) { console.error(`  retire failed for ${o.id}: ${updErr.message}`); continue; }
    retiredCount += 1;
  }
  console.log(`done. retired=${retiredCount} chunks_deleted=${chunksDeleted}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
