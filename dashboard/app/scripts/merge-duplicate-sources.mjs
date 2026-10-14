// Merge duplicate research sources: one paper ingested more than once.
//
// Most papers reached the Hub twice: as a knowledge-base text file
// (research/incoming/*.txt, with a DOI and a readable title) and as the Drive
// PDF read by the Drive sync (file name as title, no DOI). The sync only knew
// Drive file ids, so it never saw the text copy. Both copies showed in the
// catalog and Ask could retrieve and cite the same paper twice.
//
// For each group of rows that hold the same paper (same file sha256, same Drive
// file, or the same opening text) this keeps one row, links the Drive PDF to
// it, fills its empty catalog fields from the copies, and retires the copies
// (valid_until set, metadata.duplicate_of = kept row). Retired rows keep their
// chunks, so a rollback is a field restore. Rows with a chapter are never
// retired (the by-chapter copies are intentional, see migration 0003).
// It also writes metadata.fp (opening-text fingerprint, lib/sync.ts
// openingFingerprint) on every active research and book row, which the Drive
// sync and Ask use to recognise a paper already held.
//
// Usage, from dashboard/app:
//   node --env-file=.env.local scripts/merge-duplicate-sources.mjs                 dry run, writes the plan only
//   node --env-file=.env.local scripts/merge-duplicate-sources.mjs --apply         applies it, writes a rollback file
//   node --env-file=.env.local scripts/merge-duplicate-sources.mjs --rollback FILE restores the rows in FILE
//   --out DIR  where plan and rollback files go (default ../../lab-results/latest)

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ROLLBACK = args.includes('--rollback') ? args[args.indexOf('--rollback') + 1] : null;
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : '../../lab-results/latest';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', 'T');
mkdirSync(OUT, { recursive: true });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const RESTORE_COLS = ['valid_until', 'drive_file_id', 'drive_url', 'metadata', 'doi', 'year_published', 'has_pdf',
  'topic_category', 'drive_location', 'rights_share', 'rights_download', 'database_platform'];
const FILL_COLS = ['doi', 'year_published', 'topic_category', 'drive_location', 'rights_share', 'rights_download', 'database_platform'];

if (ROLLBACK) {
  const rows = JSON.parse(readFileSync(ROLLBACK, 'utf8')).rows;
  let n = 0;
  for (const r of rows) {
    const patch = Object.fromEntries(RESTORE_COLS.map((c) => [c, r[c] ?? null]));
    const { error } = await sb.from('sources').update(patch).eq('id', r.id);
    if (error) { console.error('rollback failed for', r.id, error.message); process.exit(1); }
    if (++n % 100 === 0) console.log('restored', n);
  }
  console.log(`rollback done: ${n} rows restored from ${ROLLBACK}`);
  process.exit(0);
}

// --- load -----------------------------------------------------------------
async function all(build) {
  const out = [];
  for (let o = 0; ; o += 1000) {
    const { data, error } = await build().range(o, o + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const cols = ['id', 'kind', 'title', 'path', 'chapter', 'sha256', 'created_at', ...RESTORE_COLS].join(',');
const rows = await all(() => sb.from('sources').select(cols).in('kind', ['research_paper', 'coffee_book']).is('valid_until', null));
const catalog = new Set((await all(() => sb.from('bibliography_view').select('id'))).map((r) => r.id));

const first = new Map();
const ids = rows.map((r) => r.id);
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await sb.from('chunks').select('source_id,content').in('source_id', ids.slice(i, i + 200)).eq('chunk_index', 0);
  if (error) throw error;
  for (const c of data) first.set(c.source_id, c.content);
}

const norm = (t) => String(t ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const fingerprint = (t) => createHash('sha1').update(norm(t).slice(0, 600)).digest('hex');
const cleanDoi = (d) => (d ? String(d).replace(/[\u0000-\u001f\u007f-\u009f​-‍﻿]/g, '').trim().toLowerCase() : null);
const display = (r) => r.metadata?.display?.title ?? null;
for (const r of rows) {
  r.fp = first.has(r.id) ? fingerprint(first.get(r.id)) : null;
  r.doiN = cleanDoi(r.doi);
  r.inCatalog = catalog.has(r.id);
}

// --- group: same file, same Drive file, or same opening text --------------
const parent = new Map(rows.map((r) => [r.id, r.id]));
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
for (const key of ['sha256', 'drive_file_id', 'fp']) {
  const by = new Map();
  for (const r of rows) { const k = r[key]; if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(r.id); }
  for (const g of by.values()) for (const x of g.slice(1)) parent.set(find(x), find(g[0]));
}
const groups = new Map();
for (const r of rows) { const k = find(r.id); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }

const score = (r) => (r.inCatalog ? 8 : 0) + (r.doiN ? 4 : 0) + (display(r) ? 2 : 0) + (first.has(r.id) ? 2 : 0) + (r.path ? 1 : 0)
  - (/\(\d\)|conflicted copy/i.test(`${r.path ?? ''} ${r.title ?? ''}`) ? 1 : 0);

const plan = { keep: [], retire: [], skipped: [] };
for (const g of groups.values()) {
  if (g.length < 2) continue;
  const dois = new Set(g.map((r) => r.doiN).filter(Boolean));
  const titles = new Set(g.map((r) => display(r)).filter(Boolean).map(norm));
  if (dois.size > 1) { plan.skipped.push({ reason: 'different DOIs', ids: g.map((r) => r.id) }); continue; }
  if (titles.size > 1) { plan.skipped.push({ reason: 'different readable titles', ids: g.map((r) => r.id) }); continue; }

  const keeper = [...g].sort((a, b) => score(b) - score(a) || String(a.created_at).localeCompare(String(b.created_at)))[0];
  const retire = g.filter((r) => r !== keeper && !r.chapter);
  if (!retire.length) continue;

  const patch = {};
  const meta = { ...(keeper.metadata ?? {}) };
  const driveRows = retire.filter((r) => r.drive_file_id);
  const aliases = new Set(Array.isArray(meta.drive_aliases) ? meta.drive_aliases : []);
  if (!keeper.drive_file_id && driveRows.length) {
    const primary = [...driveRows].sort((a, b) => score(b) - score(a) || String(a.created_at).localeCompare(String(b.created_at)))[0];
    patch.drive_file_id = primary.drive_file_id;
    patch.drive_url = primary.drive_url ?? `https://drive.google.com/file/d/${primary.drive_file_id}/view`;
    meta.drive_md5 = primary.metadata?.drive_md5 ?? null;
    meta.drive_sha256 = primary.sha256 ?? null;
    meta.merged_drive = true;
    for (const r of driveRows) if (r.drive_file_id !== primary.drive_file_id) aliases.add(r.drive_file_id);
  } else {
    for (const r of driveRows) if (r.drive_file_id !== keeper.drive_file_id) aliases.add(r.drive_file_id);
  }
  if (aliases.size) meta.drive_aliases = [...aliases];
  for (const c of FILL_COLS) {
    if (keeper[c] != null && keeper[c] !== '') continue;
    const v = retire.map((r) => r[c]).find((x) => x != null && x !== '');
    if (v != null) patch[c] = c === 'doi' ? cleanDoi(v) : v;
  }
  // has_pdf means full text is in the Hub; any copy that had it carries it over.
  if (!keeper.has_pdf && retire.some((r) => r.has_pdf)) patch.has_pdf = true;
  if (!display(keeper)) {
    const d = retire.find((r) => display(r) && (!keeper.doiN || r.doiN === keeper.doiN));
    if (d) meta.display = d.metadata.display;
  }
  if (keeper.fp) meta.fp = keeper.fp;
  meta.merged_copies = [...new Set([...(Array.isArray(meta.merged_copies) ? meta.merged_copies : []), ...retire.map((r) => r.id)])];
  patch.metadata = meta;

  plan.keep.push({ id: keeper.id, title: display(keeper) ?? keeper.title, patch, before: Object.fromEntries(RESTORE_COLS.map((c) => [c, keeper[c] ?? null])) });
  for (const r of retire) {
    plan.retire.push({
      id: r.id, keeper: keeper.id, title: display(r) ?? r.title, inCatalog: r.inCatalog,
      copy: r.drive_file_id ? 'drive' : 'text',
      before: Object.fromEntries(RESTORE_COLS.map((c) => [c, r[c] ?? null])),
      metadata: { ...(r.metadata ?? {}), duplicate_of: keeper.id, merged_at: new Date().toISOString(), ...(r.fp ? { fp: r.fp } : {}) },
    });
  }
}

// fp backfill for the remaining active rows
const touched = new Set([...plan.keep.map((k) => k.id), ...plan.retire.map((r) => r.id)]);
const backfill = rows.filter((r) => !touched.has(r.id) && r.fp && r.metadata?.fp !== r.fp);

const summary = {
  activeRows: rows.length,
  catalogRows: catalog.size,
  groupsMerged: plan.keep.length,
  rowsRetired: plan.retire.length,
  retiredFromCatalog: plan.retire.filter((r) => r.inCatalog).length,
  retiredDriveCopies: plan.retire.filter((r) => r.copy === 'drive').length,
  keptRowsGivenDriveLink: plan.keep.filter((k) => k.patch.drive_file_id).length,
  keptRowsWithDriveAliases: plan.keep.filter((k) => k.patch.metadata.drive_aliases?.length).length,
  keptRowsFieldsFilled: plan.keep.filter((k) => FILL_COLS.some((c) => c in k.patch)).length,
  keptRowsMarkedHasPdf: plan.keep.filter((k) => k.patch.has_pdf).length,
  groupsSkipped: plan.skipped.length,
  fingerprintBackfill: backfill.length,
};
const planFile = join(OUT, `merge-plan-${stamp}.json`);
writeFileSync(planFile, JSON.stringify({ summary, ...plan }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('plan:', planFile);
if (!APPLY) { console.log('dry run: nothing changed. Re-run with --apply.'); process.exit(0); }

// --- apply ------------------------------------------------------------------
const rollback = { createdAt: new Date().toISOString(), rows: [] };
const rollbackFile = join(OUT, `merge-rollback-${stamp}.json`);
const saveRollback = () => writeFileSync(rollbackFile, JSON.stringify(rollback));
let n = 0;
const tick = () => { if (++n % 100 === 0) { saveRollback(); console.log('updated', n); } };

for (const k of plan.keep) {
  rollback.rows.push({ id: k.id, ...k.before });
  const { error } = await sb.from('sources').update(k.patch).eq('id', k.id);
  if (error) { saveRollback(); console.error('keep update failed', k.id, error.message); process.exit(1); }
  tick();
}
const now = new Date().toISOString();
for (const r of plan.retire) {
  rollback.rows.push({ id: r.id, ...r.before });
  const { error } = await sb.from('sources').update({ valid_until: now, metadata: r.metadata }).eq('id', r.id);
  if (error) { saveRollback(); console.error('retire failed', r.id, error.message); process.exit(1); }
  tick();
}
for (const r of backfill) {
  rollback.rows.push({ id: r.id, ...Object.fromEntries(RESTORE_COLS.map((c) => [c, r[c] ?? null])) });
  const { error } = await sb.from('sources').update({ metadata: { ...(r.metadata ?? {}), fp: r.fp } }).eq('id', r.id);
  if (error) { saveRollback(); console.error('fp backfill failed', r.id, error.message); process.exit(1); }
  tick();
}
saveRollback();
console.log(`applied: ${plan.keep.length} kept, ${plan.retire.length} retired, ${backfill.length} fingerprints. Rollback: ${rollbackFile}`);
