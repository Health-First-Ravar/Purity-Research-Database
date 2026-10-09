#!/usr/bin/env node
// Build lab-results/snapshot.json from a read-only dump of Brian's Lab Testing
// tracker (a Claude artifact). Nothing here writes back to his tracker.
//
// Inputs
//   --page <file>     his page HTML, as saved by an Artifact "read" of the tracker
//   --db <dir>        his artifact database dumped with ArtifactData out_dir:
//                       <dir>/seed/*.json        { part, records: [...] }
//                       <dir>/results/*.json     records added in his tracker UI
//                       <dir>/claimseed/*.json   { part, claims: [...] }
//                       <dir>/claims/*.json      claims added in his tracker UI
//                       <dir>/config/standard.json (optional) { limits: { code: value } }
//   --out <file>      where to write the snapshot
//   --previous <file> (optional) last snapshot; if the data is identical, nothing
//                     is written and the script prints UNCHANGED
//   --page-version v  (optional) defaults to the version in the page file name
//
// The standard (limits) and the reclassification table (COMP_OV) still live in
// his page code, so they are read from the page. The literals are checked to be
// plain data (no calls, no functions) before they are evaluated.
//
// Exit codes: 0 written or unchanged, 1 bad input (nothing written).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import vm from 'node:vm';

const TRACKER_URL = 'https://claude.ai/artifact/VFhgxKpr4GCMAQ3RiRPBgr';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function fail(msg) {
  console.error(`[build-snapshot] ${msg}`);
  process.exit(1);
}

// ---------- page constants ----------

/** Return the source text of the object literal assigned to `const NAME`. */
function literalAfter(html, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(html);
  if (!m) fail(`page: const ${name} not found (has the tracker page changed?)`);
  let i = m.index + m[0].length;
  const open = html[i];
  if (open !== '{' && open !== '[') fail(`page: const ${name} is not an object literal`);
  const close = open === '{' ? '}' : ']';
  let depth = 0, quote = null;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (quote) {
      if (c === '\\') { j++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return html.slice(i, j + 1);
  }
  fail(`page: const ${name} is not terminated`);
}

/** Evaluate an object literal only if, outside strings, it is plain data. */
function evalLiteral(src, name) {
  const outside = src.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
  if (/[`()=;]/.test(outside) || /\b(function|new|get|set|this|import|require)\b/.test(outside)) {
    fail(`page: const ${name} is not plain data, refusing to evaluate it`);
  }
  return vm.runInNewContext(`(${src})`, Object.create(null), { timeout: 1000 });
}

function stringConst(html, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*'((?:\\\\.|[^'\\\\])*)'`).exec(html);
  if (!m) fail(`page: const ${name} not found`);
  return m[1];
}

// ---------- database dump ----------

function docs(dir, collection) {
  const d = join(dir, collection);
  if (!existsSync(d)) return [];
  // Same order as his tracker reads them: by document id.
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ id: f.slice(0, -5), data: JSON.parse(readFileSync(join(d, f), 'utf8')) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------- standard rows (mirrors evalOne/limitOf in his page) ----------

function standardRows(AN, GREEN, GREEN_VER, limits, pageVersion) {
  const rows = [];
  const finishedVer = `Brian tracker finished-product limits (page ${pageVersion})`;
  for (const [code, d] of Object.entries(AN)) {
    const o = limits ? limits[code] : undefined;
    const lim = o !== undefined && o !== null && o !== '' ? Number(o) : d.lim ?? null;
    let rule, value = null;
    if (d.nd) rule = 'not_detectable';
    else if (lim == null) rule = d.detect ? 'flag_detected' : 'informational';
    else { rule = 'ceiling'; value = lim; }
    rows.push({
      code, applies_to: 'finished', label: d.n, unit: d.u, grp: d.grp, rule, value,
      required: true, roasted_only: !!d.roastedOnly, version: finishedVer,
    });
  }
  for (const [code, g] of Object.entries(GREEN)) {
    const d = AN[code] || {};
    let rule, value = null;
    if (g.nd) rule = 'not_detectable';
    else if (g.max != null) { rule = 'ceiling'; value = g.max; }
    else if (g.min != null) { rule = 'floor'; value = g.min; }
    else continue;
    rows.push({
      code, applies_to: 'green', label: d.n || code, unit: d.u || '', grp: d.grp || '', rule, value,
      required: /^required/i.test(g.src || ''), roasted_only: false, version: GREEN_VER,
    });
  }
  return rows;
}

// ---------- main ----------

const pageFile = arg('--page');
const dbDir = arg('--db');
const outFile = arg('--out');
const prevFile = arg('--previous');
if (!pageFile || !dbDir || !outFile) fail('usage: --page <html> --db <dir> --out <file> [--previous <file>]');

const html = readFileSync(pageFile, 'utf8');
const pageVersion = arg('--page-version') || (basename(pageFile).match(/(\d{6,}-[0-9a-f]{3,})\.html?$/) || [])[1] || 'unknown';
const AN = evalLiteral(literalAfter(html, 'AN'), 'AN');
const GREEN = evalLiteral(literalAfter(html, 'GREEN'), 'GREEN');
const COMP_OV = evalLiteral(literalAfter(html, 'COMP_OV'), 'COMP_OV');
const GREEN_VER = stringConst(html, 'GREEN_VER');

const seed = docs(dbDir, 'seed');
if (!seed.length) fail(`db: no seed documents under ${dbDir}/seed`);
// Results added in his tracker's form are keyed by document id, and those ids
// can repeat a seed record's id (tr016-tr020 did, Oct 2026: different records).
// Prefix them so every record keeps a unique id; added_id keeps his.
const added = docs(dbDir, 'results').map((d) => ({ ...d.data, id: `res-${d.id}`, added_id: d.id }));
const records = [].concat(...seed.map((d) => d.data.records || []), added);

const claimseed = docs(dbDir, 'claimseed');
if (!claimseed.length) fail(`db: no claimseed documents under ${dbDir}/claimseed`);
const claimsAdded = docs(dbDir, 'claims').map((d) => ({ id: d.id, ...d.data }));
const claims = [].concat(...claimseed.map((d) => d.data.claims || []), claimsAdded);

const stdDoc = docs(dbDir, 'config').find((d) => d.id === 'standard');
const limits = stdDoc && stdDoc.data && stdDoc.data.limits ? stdDoc.data.limits : null;

const standard = standardRows(AN, GREEN, GREEN_VER, limits, pageVersion);

// Sanity checks before anything is written.
const ids = new Set();
for (const r of records) {
  if (!r || !r.id) fail('db: record without id');
  if (ids.has(r.id)) fail(`db: duplicate record id ${r.id}`);
  ids.add(r.id);
}
if (records.length < 100) fail(`db: only ${records.length} records, expected 100+`);
for (const id of Object.keys(COMP_OV)) if (!ids.has(id)) console.warn(`[build-snapshot] override for unknown record ${id}`);

const data = { standard, overrides: COMP_OV, records, claims };

if (prevFile && existsSync(prevFile)) {
  const prev = JSON.parse(readFileSync(prevFile, 'utf8'));
  const same = JSON.stringify({ standard: prev.standard, overrides: prev.overrides, records: prev.records, claims: prev.claims }) === JSON.stringify(data);
  if (same) {
    console.log(`UNCHANGED ${prev.snapshot_id} (${records.length} records, ${claims.length} claims)`);
    process.exit(0);
  }
}

const now = new Date();
const taken = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
const snapshot = {
  snapshot_id: 'brian-' + taken.replace(/[-:]/g, ''),
  taken_at: taken,
  source: {
    name: "Brian's Lab Testing tracker",
    url: TRACKER_URL,
    collections: ['seed', 'results', 'claimseed', 'claims', 'config/standard'],
    page_version: pageVersion,
    limit_overrides: limits || {},
  },
  notes: 'records keep the tracker order (seed documents by id, then results) so de-duplication keeps the same copy the tracker keeps; standard and overrides are read from the tracker page constants (AN, GREEN, COMP_OV) until they live in the tracker database.',
  ...data,
};
writeFileSync(outFile, JSON.stringify(snapshot, null, 1) + '\n');
console.log(`WROTE ${snapshot.snapshot_id}: ${records.length} records (${added.length} added in tracker), ${claims.length} claims, ${standard.length} standard rows, ${Object.keys(COMP_OV).length} overrides, page ${pageVersion}`);
