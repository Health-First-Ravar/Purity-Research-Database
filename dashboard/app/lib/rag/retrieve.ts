// Retrieval: canon-cache semantic lookup + pgvector chunk retrieval.
// Runs against the service-role client so RPCs aren't tripped by RLS inside
// cron/ingestion contexts. In the chat route we pass the user-scoped client.

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedOne } from '../voyage';
import type { Classification } from './classify';
import { ALL_COA_SCOPES } from '../coa-scope';
import {
  detectCoaLookup,
  fetchCoaLookupChunks,
  detectCoaThreshold,
  fetchCoaThresholdChunk,
} from './coa-lookup';
import { CUSTOMER_EXCLUDED_TYPES, type SourceType } from './source-classify';

const CANON_THRESHOLD = Number(process.env.CANON_MATCH_THRESHOLD ?? 0.82);
const CHUNK_THRESHOLD = Number(process.env.CHUNK_MATCH_THRESHOLD ?? 0.55);
const TOP_K           = Number(process.env.RETRIEVAL_TOP_K ?? 8);

export type CanonHit = {
  id: string;
  question: string;
  answer: string;
  similarity: number;
  freshness_tier: 'stable' | 'weekly' | 'batch';
  next_review_due: string | null;
};

export type ChunkHit = {
  id: string;
  source_id: string;
  heading: string | null;
  content: string;
  similarity: number;
  kind: string;
  title: string;
  chapter: string | null;
  // Set when the chunk was selected structurally (by report_date / report_number)
  // rather than by embedding distance. Renders as `selected=<via>` in evidence.
  via?: 'report_date' | 'report_number';
};

export async function findCanonHit(
  client: SupabaseClient,
  question: string,
  cls: Classification,
): Promise<CanonHit | null> {
  if (cls.requires_fresh) return null;
  const emb = await embedOne(question, 'query');
  const { data, error } = await client.rpc('match_canon', {
    query_embedding: emb as unknown as string, // supabase-js serializes arrays
    match_count: 3,
    min_similarity: CANON_THRESHOLD,
  });
  if (error) throw error;
  const hits = (data ?? []) as CanonHit[];
  return hits[0] ?? null;
}

/**
 * @param allowedCoaScopes restricts COA-derived chunks by coas.product_scope.
 *   `null` = unrestricted (editors, admins, ingestion). `['purity']` = the
 *   customer-service allowlist. Passed into the RPC so the restriction is
 *   applied in SQL — a post-fetch filter would still have pulled a competitor's
 *   or an unidentified lot's lab text into this process, and would need
 *   re-implementing correctly at every call site.
 */
export async function retrieveChunks(
  client: SupabaseClient,
  question: string,
  cls: Classification,
  allowedCoaScopes: string[] | null = null,
): Promise<ChunkHit[]> {
  const emb = await embedOne(question, 'query');
  // Category-based source kind bias. Coarse but effective at MVP.
  const kinds = kindsForCategory(cls.category);
  const { data, error } = await client.rpc('match_chunks', {
    query_embedding: emb as unknown as string,
    match_count: TOP_K * 2, // over-fetch; the vetted-source filter below trims back to TOP_K
    source_kinds: kinds,
    min_similarity: CHUNK_THRESHOLD,
    allowed_coa_scopes: allowedCoaScopes,
  });
  if (error) throw error;
  // Customer-facing retrieval: drop research sources tagged as non-science
  // (media, marketing, certificate, competitor) so a health answer is never
  // backed by a HuffPost article or a competitor's lab test. Reva has its own
  // retrieval path and is intentionally unaffected. Then trim to TOP_K.
  const vetted = await dropUnvettedResearch(
    client,
    ((data ?? []) as ChunkHit[]).filter(isSubstantiveChunk),
  );
  const semantic = vetted.slice(0, TOP_K);

  // Structured COA leg — same fix as Reva's COA path. "Most recent COA" is an
  // ORDER (report_date) and "COA <report#>" is a KEY (report_number); neither
  // survives nearest-neighbour ranking, so for those signals we select from
  // `coas` directly and prepend the certificates' already-embedded chunks.
  // Runs on the same caller client (RLS applies) with the same scope allowlist;
  // `null` (elevated) maps to the full scope list, mirroring coa-scope.
  const scopes = allowedCoaScopes ?? [...ALL_COA_SCOPES];
  const structured: ChunkHit[] = [];

  // Threshold / aggregate leg: "which lots exceed X", "how many over the limit".
  // A numeric predicate is a WHERE clause, not a similarity, so answer it from
  // `coas` directly and prepend one authoritative, complete result block. This
  // is what stops the false all-clear semantic retrieval produces here.
  const threshold = detectCoaThreshold(question);
  if (threshold) {
    structured.push(...(await fetchCoaThresholdChunk(client, threshold, scopes)));
  }

  // Date / specific-report leg — "most recent COA" (an ORDER) and "COA <report#>"
  // (a KEY), neither of which survives nearest-neighbour ranking.
  const signals = detectCoaLookup(question);
  if (signals.recency || signals.reportTokens.length) {
    structured.push(...(await fetchCoaLookupChunks(client, signals, scopes)));
  }

  if (structured.length) {
    const seen = new Set<string>();
    return [...structured, ...semantic].filter((c) =>
      seen.has(c.id) ? false : (seen.add(c.id), true),
    );
  }
  return semantic;
}

// Some ingested book-manuscript chunks are blank pages or parser boilerplate
// ("this page intentionally left blank") that carry no evidence yet can still
// surface as citations. Drop them before they reach context or the sources list.
function isSubstantiveChunk(c: ChunkHit): boolean {
  const t = (c.content ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 20) return false;
  if (/this page (is )?intentionally left blank/i.test(t)) return false;
  return true;
}

// Customer-facing safety filter: research sources carry a `source_type` in
// sources.metadata (set by ingest via the classifier). Drop the types a customer
// answer must never cite. Only `research_paper` chunks can carry an excluded
// type, so other kinds pass untouched. Fails OPEN on a lookup error, since the
// primary retrieval already succeeded and dropping all evidence on a secondary
// hiccup is worse than the rare miss the excluded types represent.
async function dropUnvettedResearch(
  client: SupabaseClient,
  chunks: ChunkHit[],
): Promise<ChunkHit[]> {
  const researchIds = [
    ...new Set(chunks.filter((c) => c.kind === 'research_paper').map((c) => c.source_id)),
  ];
  if (!researchIds.length) return chunks;
  const { data, error } = await client.from('sources').select('id, metadata').in('id', researchIds);
  if (error) {
    console.error('[retrieve] source_type lookup failed, keeping all chunks:', error.message);
    return chunks;
  }
  const excluded = new Set<string>();
  for (const s of (data ?? []) as { id: string; metadata: Record<string, unknown> | null }[]) {
    const t = (s.metadata?.source_type ?? null) as SourceType | null;
    if (t && CUSTOMER_EXCLUDED_TYPES.has(t)) excluded.add(s.id);
  }
  return chunks.filter((c) => !excluded.has(c.source_id));
}

function kindsForCategory(cat: Classification['category']): string[] | null {
  switch (cat) {
    case 'coa':
      return ['coa', 'product_pdf', 'purity_brain'];
    case 'blend':
      return ['purity_brain', 'product_pdf', 'coa', 'research_paper', 'coffee_book'];
    case 'health':
      // Lab-data questions (heavy metals, mycotoxins, acrylamide) often classify as
      // health — include `coa` so chat can pull our actual analyte values, not just
      // research-paper background.
      return ['research_paper', 'coffee_book', 'purity_brain', 'reva_skill', 'coa'];
    case 'product':
      return ['purity_brain', 'product_pdf', 'faq', 'coa'];
    case 'shipping':
    case 'subscription':
      return ['faq', 'purity_brain'];
    default:
      return null; // search everything
  }
}
