// Dedupe the 34-paper research/ corpus against the 448-row bibliography.
//
// The two tables of rows that this merges:
//
//   (a) Research source rows — inserted by scripts/ingest-kb.ts.
//       Identified by `path` (e.g. research/by-chapter/03/freedman-2012.txt).
//       Have chunks via FK. No DOI. title is often garbled PDF first-line.
//
//   (b) Bibliography placeholder rows — inserted by scripts/import-bibliography.ts.
//       Identified by `doi`. No chunks. title is the real paper name.
//       Rich metadata: topic_category, drive_location, rights_*, year_published.
//
// Bridge: extract a DOI from the .txt content of each research paper, look up
// the bibliography row with that DOI, and merge its metadata onto the research
// source row. Then retire the bibliography placeholder so the catalog row and
// the chunked-research row no longer coexist for the same paper.
//
// Note: migration 0003 drops the partial-unique index on `doi` so that research
// papers which live under two chapter folders (intentional per KB README) can
// both carry the same DOI. The Bibliography UI deduplicates via
// bibliography_view (DISTINCT ON doi, preferring has_pdf=true rows).
//
// Residuals (no DOI in-text, or DOI present but not in xlsx): research row
// gets has_pdf=true so it still surfaces in the Bibliography page, but
// topic_category / drive_location remain null. Logged to a JSON report.
//
// Manual overrides: scripts/manual_doi_overrides.json maps `shortname` → DOI
// for the handful of papers where the DOI isn't printed in the article body
// (e.g. some NEJM papers) or where the .txt is a mislabeled file.
//
// Usage:
//   tsx scripts/dedupe-research.ts [--manifest /path] [--kb /path] [--dry]
//
// Env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const MANIFEST_ARG = process.argv.indexOf('--manifest');
const KB_ARG = process.argv.indexOf('--kb');
const OVERRIDES_ARG = process.argv.indexOf('--overrides');

const DEFAULT_KB = '/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data/knowledge-base';
const KB_ROOT = KB_ARG >= 0 ? process.argv[KB_ARG + 1] : DEFAULT_KB;
const MANIFEST = MANIFEST_ARG >= 0 ? process.argv[MANIFEST_ARG + 1] : join(KB_ROOT, 'research', 'manifest.json');
const OVERRIDES = OVERRIDES_ARG >= 0 ? process.argv[OVERRIDES_ARG + 1] : join(SCRIPT_DIR, 'manual_doi_overrides.json');
const DRY = process.argv.includes('--dry');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL/service-role key required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// Scan-wide DOI regex. Conservative — DOIs are long-lived and the prefix 10.NNNN/ is load-bearing.
// Trailing punctuation ( . , ) ; : ] ) is trimmed post-match because PDF→text often welds it on.
const DOI_RE = /\b10\.\d{4,9}\/[A-Za-z0-9._()/:;<>\-]+/g;
const TRAILING_PUNCT = /[.,;:)\]]+$/;

// PDF-to-text commonly leaves ligatures (ﬁ, ﬂ, ...) and smart quotes in-line. Normalize them
// before DOI scan so e.g. "10.1016/j.ﬁtote.2009.10.003" resolves rather than truncating at "10.1016/j".
const LIGATURES: Record<string, string> = {
  '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl',
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-',
};
function normalizeText(s: string): string {
  let out = s;
  for (const [from, to] of Object.entries(LIGATURES)) out = out.split(from).join(to);
  return out;
}

// A DOI shorter than this (post-prefix) is almost always a truncation artifact and should be rejected.
const MIN_DOI_SUFFIX_LEN = 6;

type ManifestPaper = {
  fileId: string;
  chapter: string;
  shortname: string;
  title: string;
  drive_url: string;
  pdf_path: string;
  txt_path: string;
  pdf_bytes: number;
  txt_bytes: number;
  sha256_short: string;
};

type Manifest = { version: number; papers: ManifestPaper[] };

type Overrides = Record<string, string>;

type ReportEntry = {
  shortname: string;
  chapter: string;
  txt_path: string;
  doi: string | null;
  doi_source: 'extracted' | 'override' | null;
  bibliography_matched: boolean;
  research_source_id: string | null;
  retired_bibliography_id: string | null;
  notes: string[];
};

function extractDoi(text: string): string | null {
  const normalized = normalizeText(text);
  const hits = normalized.match(DOI_RE);
  if (!hits || !hits.length) return null;
  // Pick the first match — DOIs near the top of the article body are typically the article's own.
  // References further down can contain unrelated DOIs; the article's own DOI almost always
  // appears in the header, abstract footer, or first-page footnote.
  for (const raw of hits) {
    const cleaned = raw.replace(TRAILING_PUNCT, '');
    const suffix = cleaned.split('/')[1] ?? '';
    if (suffix.length < MIN_DOI_SUFFIX_LEN) continue; // truncation artifact
    return cleaned;
  }
  return null;
}

async function findBibliographyRow(doi: string) {
  const { data, error } = await sb
    .from('sources')
    .select('id, title, year_published, topic_category, drive_location, rights_share, rights_download, database_platform, path, sha256')
    .eq('doi', doi)
    .is('valid_until', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findResearchRow(relPath: string) {
  const { data, error } = await sb
    .from('sources')
    .select('id, title, doi, has_pdf')
    .eq('path', relPath)
    .is('valid_until', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function retireBibliographyRow(id: string) {
  const { error } = await sb
    .from('sources')
    .update({ valid_until: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

async function mergeOntoResearchRow(
  researchId: string,
  doi: string,
  biblio: NonNullable<Awaited<ReturnType<typeof findBibliographyRow>>> | null,
  fallbackDriveUrl: string,
) {
  const patch: Record<string, unknown> = {
    doi,
    has_pdf: true,
    drive_url: fallbackDriveUrl,
  };
  if (biblio) {
    // Prefer bibliography's real title; carry all rich metadata over.
    if (biblio.title) patch.title = biblio.title;
    if (biblio.year_published != null) patch.year_published = biblio.year_published;
    if (biblio.topic_category) patch.topic_category = biblio.topic_category;
    if (biblio.drive_location) patch.drive_location = biblio.drive_location;
    if (biblio.rights_share) patch.rights_share = biblio.rights_share;
    if (biblio.rights_download) patch.rights_download = biblio.rights_download;
    if (biblio.database_platform) patch.database_platform = biblio.database_platform;
  }
  const { error } = await sb.from('sources').update(patch).eq('id', researchId);
  if (error) throw error;
}

async function markResearchAsHasPdf(researchId: string, fallbackDriveUrl: string) {
  const { error } = await sb
    .from('sources')
    .update({ has_pdf: true, drive_url: fallbackDriveUrl })
    .eq('id', researchId);
  if (error) throw error;
}

async function main() {
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const overrides: Overrides = existsSync(OVERRIDES)
    ? JSON.parse(readFileSync(OVERRIDES, 'utf8'))
    : {};

  console.log(`[dedupe] manifest=${MANIFEST} (${manifest.papers.length} papers)`);
  console.log(`[dedupe] overrides=${Object.keys(overrides).length} entries`);
  if (DRY) console.log('[dedupe] DRY RUN — no writes');

  const report: ReportEntry[] = [];
  let matched = 0, unmatched = 0, doiless = 0, researchMissing = 0;
  // Cache bibliography rows by DOI so repeat DOI encounters (same paper under two chapter
  // folders — intentional per KB README) get the full metadata merge, not just a stub.
  type BiblioRow = NonNullable<Awaited<ReturnType<typeof findBibliographyRow>>>;
  const biblioCache = new Map<string, BiblioRow | null>();

  for (const paper of manifest.papers) {
    const relPath = `research/${paper.txt_path}`;
    const absPath = join(KB_ROOT, relPath);
    const entry: ReportEntry = {
      shortname: paper.shortname,
      chapter: paper.chapter,
      txt_path: paper.txt_path,
      doi: null,
      doi_source: null,
      bibliography_matched: false,
      research_source_id: null,
      retired_bibliography_id: null,
      notes: [],
    };

    if (!existsSync(absPath)) {
      entry.notes.push(`txt missing at ${absPath}`);
      report.push(entry);
      continue;
    }

    const txt = readFileSync(absPath, 'utf8');
    let doi = extractDoi(txt);
    if (doi) {
      entry.doi_source = 'extracted';
    } else if (overrides[paper.shortname]) {
      doi = overrides[paper.shortname];
      entry.doi_source = 'override';
      entry.notes.push('doi from manual override');
    }
    entry.doi = doi;

    const research = await findResearchRow(relPath);
    if (!research) {
      entry.notes.push('research source row not found — did ingest-kb run?');
      researchMissing++;
      report.push(entry);
      continue;
    }
    entry.research_source_id = research.id;

    if (!doi) {
      doiless++;
      entry.notes.push('no DOI extractable and no override; marked has_pdf only');
      if (!DRY) {
        await markResearchAsHasPdf(research.id, paper.drive_url);
      }
      report.push(entry);
      continue;
    }

    // Skip if the research row already carries this DOI — idempotent re-run.
    if (research.doi === doi && research.has_pdf) {
      entry.notes.push('already deduped');
      matched++;
      report.push(entry);
      continue;
    }

    let biblio: BiblioRow | null;
    if (biblioCache.has(doi)) {
      biblio = biblioCache.get(doi) ?? null;
      if (biblio) entry.notes.push('bibliography metadata applied from cache');
    } else {
      biblio = await findBibliographyRow(doi);
      biblioCache.set(doi, biblio);
      if (biblio) {
        // Retire the catalog row on first encounter so the second research row carrying
        // this DOI no longer collides on lookup. The cached metadata is what we apply.
        if (biblio.id !== research.id) {
          if (!DRY) await retireBibliographyRow(biblio.id);
        } else {
          entry.notes.push('bibliography and research row already unified');
        }
      }
    }

    if (biblio) {
      entry.bibliography_matched = true;
      entry.retired_bibliography_id = biblio.id;
      if (!DRY) await mergeOntoResearchRow(research.id, doi, biblio, paper.drive_url);
      matched++;
    } else {
      entry.notes.push('doi extracted but no bibliography row carries it — orphan');
      if (!DRY) await mergeOntoResearchRow(research.id, doi, null, paper.drive_url);
      unmatched++;
    }

    report.push(entry);
  }

  const reportPath = join(KB_ROOT, 'research', 'dedupe_report.json');
  if (!DRY) {
    writeFileSync(reportPath, JSON.stringify({
      generated: new Date().toISOString(),
      summary: { total: manifest.papers.length, matched, unmatched, doiless, researchMissing },
      entries: report,
    }, null, 2));
  }

  console.log('');
  console.log(`[dedupe] summary:`);
  console.log(`  total            = ${manifest.papers.length}`);
  console.log(`  matched          = ${matched}   (DOI found, bibliography row merged + retired)`);
  console.log(`  unmatched (DOI)  = ${unmatched} (DOI in text, but not in the xlsx catalog)`);
  console.log(`  doiless          = ${doiless}   (no DOI extractable; has_pdf set only)`);
  console.log(`  research_missing = ${researchMissing}`);
  console.log(`  report           = ${DRY ? '(dry — not written)' : reportPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
