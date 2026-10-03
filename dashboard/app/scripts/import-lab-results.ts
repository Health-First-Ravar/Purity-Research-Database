// Import a snapshot of Brian's Lab Testing tracker into lab_results,
// lab_standard and lab_claims, and log the run in sync_runs.
//
// Read-only with respect to Brian's tracker: the snapshot is produced by a
// Claude task that reads his artifact database and writes
// lab-results/snapshot.json. This script never writes back.
//
// Usage (from dashboard/app):
//   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-lab-results.ts
//   ... --snapshot /path/to/snapshot.json   --dry
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { buildStandard, recordStatus, type LabRecord, type StdRow } from '../lib/lab-status';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SNAPSHOT = arg('--snapshot') || resolve(process.cwd(), '..', '..', 'lab-results', 'snapshot.json');
const DRY = process.argv.includes('--dry');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL/service-role key required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

type BrianRecord = {
  id: string; kind: string; product?: string | null; name?: string; desc?: string; lab?: string;
  stype?: string; date?: string; status?: string; order?: string; sample?: string; report?: string;
  src?: string; link?: string; r?: Record<string, { v?: number; q?: string; raw?: string; rt?: boolean }[]>;
};
type BrianClaim = {
  id: string; claim: string; category?: string; channel?: string; src?: string; risk?: string;
  products?: string[]; count?: number; evidence_needed?: string; evidence_type?: string; notes?: string;
  locations?: { title?: string; url?: string; status?: string; date?: string }[];
};
type Snapshot = {
  snapshot_id: string; taken_at: string; source: { name: string; url: string };
  standard: StdRow[]; records: BrianRecord[]; claims: BrianClaim[];
};

const KINDS = new Set(['product', 'green', 'rd', 'roasted-other', 'competitor']);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validate(s: Snapshot): string[] {
  const errs: string[] = [];
  if (!s.snapshot_id) errs.push('missing snapshot_id');
  if (!Array.isArray(s.records) || s.records.length < 100) errs.push(`records: expected 100+, got ${s.records?.length}`);
  if (!Array.isArray(s.claims)) errs.push('claims missing');
  if (!Array.isArray(s.standard) || s.standard.length < 10) errs.push('standard missing or short');
  const seen = new Set<string>();
  for (const r of s.records || []) {
    if (!r.id) { errs.push('record without id'); continue; }
    if (seen.has(r.id)) errs.push(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (!KINDS.has(r.kind)) errs.push(`${r.id}: unknown kind ${r.kind}`);
    if (r.date && !ISO.test(r.date)) errs.push(`${r.id}: bad date ${r.date}`);
    if (r.r && typeof r.r !== 'object') errs.push(`${r.id}: analytes not an object`);
  }
  return errs.slice(0, 20);
}

const normReport = (x?: string | null) => (x ? x.trim().toUpperCase().replace(/-0$/, '') : null);
const normFile = (x?: string | null) => (x ? x.trim().toLowerCase().replace(/\.pdf$/, '') : null);

async function certificateIndex() {
  // Existing data only: coas carry the PDF file name, sources carry its Drive link.
  const { data: coas, error: e1 } = await sb.from('coas').select('report_number, sample_id, pdf_filename');
  if (e1) throw e1;
  const { data: srcs, error: e2 } = await sb.from('sources').select('title, drive_url').eq('kind', 'coa').not('drive_url', 'is', null);
  if (e2) throw e2;
  const byFile = new Map<string, string>();
  for (const s of srcs || []) { const k = normFile(s.title); if (k && s.drive_url) byFile.set(k, s.drive_url); }
  const bySample = new Map<string, string>();
  const byReport = new Map<string, string>();
  for (const c of coas || []) {
    const url = byFile.get(normFile(c.pdf_filename) || '');
    if (!url) continue;
    if (c.sample_id) bySample.set(String(c.sample_id), url);
    const r = normReport(c.report_number);
    if (r) byReport.set(r, url);
  }
  return { bySample, byReport };
}

async function main() {
  const snap: Snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const errs = validate(snap);
  if (errs.length) {
    console.error('[import-lab-results] snapshot rejected:\n  ' + errs.join('\n  '));
    if (!DRY) await sb.from('sync_runs').insert({ snapshot_id: snap.snapshot_id || 'unknown', taken_at: snap.taken_at, status: 'rejected', detail: { errors: errs } });
    process.exit(1);
  }

  const std = buildStandard(snap.standard);
  const certs = await certificateIndex();
  const statusCounts: Record<string, number> = {};
  let certMatched = 0;

  const rows = snap.records.map((r) => {
    const rec: LabRecord = {
      id: r.id, kind: r.kind, product: r.product ?? null, name: r.name ?? null, description: r.desc ?? null,
      sample_type: r.stype ?? null, status: r.status ?? null, test_date: r.date ?? null, lab: r.lab ?? null,
      analytes: (r.r || {}) as LabRecord['analytes'],
    };
    const computed = recordStatus(rec, std);
    statusCounts[computed] = (statusCounts[computed] || 0) + 1;
    const link = r.link && /^https?:\/\//.test(r.link) ? r.link : null;
    const cert = link || (r.sample && certs.bySample.get(String(r.sample))) || certs.byReport.get(normReport(r.report) || '') || null;
    if (cert) certMatched++;
    return {
      id: r.id, kind: r.kind, product: rec.product, name: rec.name, description: rec.description, lab: rec.lab,
      sample_type: rec.sample_type, test_date: rec.test_date, status: rec.status,
      order_number: r.order ?? null, sample_number: r.sample ?? null, report_number: r.report ?? null,
      source: r.src ?? null, analytes: rec.analytes, computed_status: computed, certificate_url: cert,
      snapshot_id: snap.snapshot_id, synced_at: new Date().toISOString(),
    };
  });

  const claims = snap.claims.map((c) => ({
    id: c.id, claim: c.claim, category: c.category ?? null, channel: c.channel ?? null, source_group: c.src ?? null,
    risk: c.risk ?? null, products: c.products ?? [], occurrences: c.count ?? 1, evidence_needed: c.evidence_needed ?? null,
    evidence_type: c.evidence_type ?? null, notes: c.notes ?? null, locations: c.locations ?? [],
    snapshot_id: snap.snapshot_id, synced_at: new Date().toISOString(),
  }));

  const detail = { status_counts: statusCounts, certificates_matched: certMatched, source: snap.source?.url };
  console.log(`[import-lab-results] ${rows.length} records, ${claims.length} claims, ${snap.standard.length} standard rows`);
  console.log(`[import-lab-results] ${certMatched} records linked to an existing certificate PDF`);
  console.log('[import-lab-results] computed status:', statusCounts);
  if (DRY) { console.log('[import-lab-results] dry run, nothing written'); return; }

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from('lab_results').upsert(rows.slice(i, i + 200), { onConflict: 'id' });
    if (error) throw error;
  }
  // Mirror deletions: anything not in this snapshot is gone from Brian's tracker.
  const { error: delErr } = await sb.from('lab_results').delete().neq('snapshot_id', snap.snapshot_id);
  if (delErr) throw delErr;

  const { error: stdErr } = await sb.from('lab_standard').upsert(snap.standard, { onConflict: 'code,applies_to' });
  if (stdErr) throw stdErr;

  // Claims: upsert Brian's fields only, so research_verdict / review_status set in the Hub survive.
  for (let i = 0; i < claims.length; i += 200) {
    const { error } = await sb.from('lab_claims').upsert(claims.slice(i, i + 200), { onConflict: 'id' });
    if (error) throw error;
  }

  const { error: logErr } = await sb.from('sync_runs').insert({
    snapshot_id: snap.snapshot_id, taken_at: snap.taken_at, records: rows.length, claims: claims.length, status: 'ok', detail,
  });
  if (logErr) throw logErr;
  console.log('[import-lab-results] done');
}

main().catch(async (e) => {
  console.error('[import-lab-results] failed:', e?.message || e);
  process.exit(1);
});
