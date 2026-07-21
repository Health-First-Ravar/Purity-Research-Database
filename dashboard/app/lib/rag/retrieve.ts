// Retrieval: canon-cache semantic lookup + pgvector chunk retrieval.
// Runs against the service-role client so RPCs aren't tripped by RLS inside
// cron/ingestion contexts. In the chat route we pass the user-scoped client.

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedOne } from '../voyage';
import type { Classification } from './classify';
import { ALL_COA_SCOPES } from '../coa-scope';
import { detectCoaLookup, fetchCoaLookupChunks } from './coa-lookup';

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
    match_count: TOP_K,
    source_kinds: kinds,
    min_similarity: CHUNK_THRESHOLD,
    allowed_coa_scopes: allowedCoaScopes,
  });
  if (error) throw error;
  const semantic = (data ?? []) as ChunkHit[];

  // Structured COA leg — same fix as Reva's COA path. "Most recent COA" is an
  // ORDER (report_date) and "COA <report#>" is a KEY (report_number); neither
  // survives nearest-neighbour ranking, so for those signals we select from
  // `coas` directly and prepend the certificates' already-embedded chunks.
  // Runs on the same caller client (RLS applies) with the same scope allowlist;
  // `null` (elevated) maps to the full scope list, mirroring coa-scope.
  const signals = detectCoaLookup(question);
  if (signals.recency || signals.reportTokens.length) {
    const structured = await fetchCoaLookupChunks(
      client,
      signals,
      allowedCoaScopes ?? [...ALL_COA_SCOPES],
    );
    if (structured.length) {
      const seen = new Set<string>();
      return [...structured, ...semantic].filter((c) =>
        seen.has(c.id) ? false : (seen.add(c.id), true),
      );
    }
  }
  return semantic;
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
