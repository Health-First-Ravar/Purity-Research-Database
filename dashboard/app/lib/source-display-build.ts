// Readable titles for research sources: builds `sources.metadata.display`
// ({ title, authors, year, journal, doi, from }) from Crossref.
//
// Used by scripts/source-display-titles.ts (bulk backfill, with a local cache
// and the research-manifest twin lookup) and by the daily Drive sync
// (lib/sync.ts), which fills new rows after each run so new papers get a
// readable title without anyone running the script.
//
// DOI sources, in order: the row's own DOI; for a research paper with none (or
// one Crossref does not know), a DOI printed on its first page, accepted only
// when the Crossref title for it also appears on that page. That check keeps a
// cited paper's DOI from naming the citing one. Book chapters never use the
// page DOI: their first pages cite other work.

import type { SupabaseClient } from '@supabase/supabase-js';
import { validDoi } from './doi';

export type DisplayFrom = 'crossref' | 'twin' | 'page-doi';
export type SourceDisplay = {
  title: string;
  authors?: string[];
  year?: number | null;
  journal?: string | null;
  doi?: string | null;
  from: DisplayFrom;
};
export type CrossrefHit = { title: string; authors: string[]; year: number | null; journal: string | null } | null;

// Optional contact for Crossref's polite pool; requests work without it.
const MAILTO = process.env.CROSSREF_MAILTO?.trim() || null;

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Crossref metadata for a DOI; null when Crossref has no record. Throws on network or server errors (retry later). */
export async function crossrefWork(doi: string): Promise<CrossrefHit> {
  const q = MAILTO ? `?mailto=${encodeURIComponent(MAILTO)}` : '';
  const headers = { 'User-Agent': `PurityResearchHub/1.0${MAILTO ? ` (mailto:${MAILTO})` : ''}` };
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}${q}`, { headers, signal: AbortSignal.timeout(15000) });
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

const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>]+/g;

/** Up to `max` distinct well-formed DOIs printed in the text, in order. */
export function doisInText(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DOI_IN_TEXT)) {
    const d = validDoi(m[0].replace(/[.,;:)\]}]+$/, ''));
    if (d && !out.some((x) => x.toLowerCase() === d.toLowerCase())) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

const words = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/-\s*\n\s*/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4);

/** True when at least 75% of the title's longer words appear in the page text. */
export function titleOnPage(title: string, page: string): boolean {
  const t = [...new Set(words(title))];
  if (t.length < 2) return false;
  const p = new Set(words(page));
  return t.filter((w) => p.has(w)).length / t.length >= 0.75;
}

export const displayFromHit = (hit: NonNullable<CrossrefHit>, doi: string, from: DisplayFrom): SourceDisplay => ({ ...hit, doi, from });

/**
 * The display record for one source, from its own DOI or (research papers only)
 * a verified DOI on its first page. `lookup` defaults to Crossref; the backfill
 * script passes a cached version. Returns null when nothing qualifies.
 */
export async function buildDisplay(
  src: { kind: string; doi: string | null },
  firstPage: string | null,
  lookup: (doi: string) => Promise<CrossrefHit> = crossrefWork,
): Promise<SourceDisplay | null> {
  const own = validDoi(src.doi);
  if (own) {
    const hit = await lookup(own);
    if (hit) return displayFromHit(hit, own, 'crossref');
  }
  if (src.kind !== 'research_paper' || !firstPage) return null;
  const top = firstPage.slice(0, 3000);
  for (const d of doisInText(top)) {
    if (own && d.toLowerCase() === own.toLowerCase()) continue;
    const hit = await lookup(d);
    if (hit && titleOnPage(hit.title, top)) return displayFromHit(hit, d, 'page-doi');
  }
  return null;
}

/** Opening text of a source (its first chunk). */
export async function firstPageText(sb: SupabaseClient, sourceId: string): Promise<string | null> {
  const { data } = await sb.from('chunks').select('content').eq('source_id', sourceId).order('chunk_index').limit(1);
  return (data?.[0]?.content as string | undefined) ?? null;
}

/**
 * Fill `metadata.display` for active research and book sources that have none
 * and have not been checked yet, newest first. Each row checked gets
 * `metadata.display_checked` (a date) so a paper with no usable DOI is not
 * looked up every day. A Crossref error leaves the row unchecked for the next
 * run. Never throws for a single row.
 */
export async function fillMissingDisplayTitles(
  sb: SupabaseClient,
  opts: { limit?: number; budgetMs?: number } = {},
): Promise<{ checked: number; filled: number }> {
  const deadline = Date.now() + (opts.budgetMs ?? 30000);
  const { data, error } = await sb.from('sources').select('id, kind, doi, metadata')
    .in('kind', ['research_paper', 'coffee_book']).is('valid_until', null)
    .is('metadata->display', null).is('metadata->display_checked', null)
    .order('created_at', { ascending: false }).limit(opts.limit ?? 20);
  if (error) throw error;
  let checked = 0, filled = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const r of (data ?? []) as { id: string; kind: string; doi: string | null; metadata: Record<string, unknown> | null }[]) {
    if (Date.now() > deadline) break;
    try {
      const display = await buildDisplay(r, r.kind === 'research_paper' ? await firstPageText(sb, r.id) : null);
      const metadata = { ...(r.metadata ?? {}), ...(display ? { display } : {}), display_checked: today };
      const { error: upErr } = await sb.from('sources').update({ metadata }).eq('id', r.id);
      if (upErr) throw upErr;
      checked++;
      if (display) filled++;
    } catch (e) {
      console.warn(`[display-titles] ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { checked, filled };
}
