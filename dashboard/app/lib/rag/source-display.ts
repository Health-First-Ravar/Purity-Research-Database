// Server-side lookup of sources.metadata.display (see
// scripts/source-display-titles.ts) for the sources an answer cites.

import { supabaseAdmin } from '../supabase';
import type { SourceDisplay } from './source-label';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** source_id -> display record, for the ids given. Empty on any error (titles fall back to cleanup). */
export async function sourceDisplays(sourceIds: string[]): Promise<Map<string, SourceDisplay>> {
  const ids = [...new Set(sourceIds.filter((id) => UUID.test(id)))];
  const out = new Map<string, SourceDisplay>();
  if (!ids.length) return out;
  try {
    // Batches of 100 keep the request URL short (the library asks for up to 500).
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabaseAdmin().from('sources').select('id, metadata').in('id', ids.slice(i, i + 100));
      if (error) throw error;
      for (const s of (data ?? []) as { id: string; metadata: Record<string, unknown> | null }[]) {
        const d = s.metadata?.display as SourceDisplay | undefined;
        if (d?.title) out.set(s.id, d);
      }
    }
  } catch (e) {
    console.error('[source-display] lookup failed:', e instanceof Error ? e.message : e);
  }
  return out;
}
