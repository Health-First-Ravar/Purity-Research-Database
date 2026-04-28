// Retrieval: canon-cache semantic lookup + pgvector chunk retrieval.
// Runs against the service-role client so RPCs aren't tripped by RLS inside
// cron/ingestion contexts. In the chat route we pass the user-scoped client.

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedOne } from '../voyage';
import type { Classification } from './classify';

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

export async function retrieveChunks(
  client: SupabaseClient,
  question: string,
  cls: Classification,
): Promise<ChunkHit[]> {
  const emb = await embedOne(question, 'query');
  // Category-based source kind bias. Coarse but effective at MVP.
  const kinds = kindsForCategory(cls.category);
  const { data, error } = await client.rpc('match_chunks', {
    query_embedding: emb as unknown as string,
    match_count: TOP_K,
    source_kinds: kinds,
    min_similarity: CHUNK_THRESHOLD,
  });
  if (error) throw error;
  return (data ?? []) as ChunkHit[];
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
