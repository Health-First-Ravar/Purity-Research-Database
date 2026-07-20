// Who may see which COA rows.
//
// `coas` is the landing zone for every COA we receive, including third-party
// products held for benchmarking and lots we have not yet identified. Customer
// service must only ever see COAs for products we actually sell.
//
// This is an ALLOWLIST, not a blocklist. CS sees `product_scope = 'purity'` and
// nothing else, so `unclassified` is invisible by default. That matters because
// the table keeps receiving new material: a blocklist would show anything a
// brand-name regex failed to recognise, and two separate passes over this
// corpus each missed a competitor whose filename used underscores. Failing
// closed means an unrecognised row is withheld rather than misattributed.
//
// The audit team (admin/editor) sees everything, competitors included — that
// comparison data is the point of holding it.

import { hasElevatedAccess, type DbRole } from './auth-roles';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The only scope customer service may read. */
export const CS_SCOPE = 'purity' as const;

/**
 * Every value `coas.product_scope` may hold (migration 0002's CHECK).
 *
 * Passing this to `match_chunks` is NOT the same as passing `null`, even though
 * both admit all three scopes. `null` short-circuits the scope predicate
 * entirely; a non-null list forces the `path ~ '^coa:<uuid>$'` join to a live
 * `coas` row. That join is what separates a real certificate from the ~308
 * `kind='coa'` sources that `lib/sync.ts` blanket-labelled without classifying
 * — a group that includes twelve copies of the book manuscript. Those score
 * HIGHER on a health or brand question than a genuine analyte table does, so a
 * similarity threshold cannot tell them apart. The provenance join can.
 */
export const ALL_COA_SCOPES = ['purity', 'competitor', 'unclassified'] as const;

export type CoaViewer = { role: DbRole; elevated: boolean };

/**
 * Resolve the caller's COA visibility.
 *
 * Defaults to NOT elevated for a signed-out user, a missing profile row, or a
 * failed lookup, so every error path narrows visibility rather than widening
 * it.
 */
export async function getCoaViewer(
  supabase: SupabaseClient,
): Promise<CoaViewer> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { role: null, elevated: false };
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', auth.user.id)
      .single();
    return { role: profile?.role ?? null, elevated: hasElevatedAccess(profile?.role) };
  } catch {
    return { role: null, elevated: false };
  }
}

/**
 * Narrow a PostgREST query on `coas` to what this viewer may see.
 *
 * Applied to the QUERY, so restricted rows never enter the response payload —
 * they cannot leak through a serialised prop, a CSV built from the same rows,
 * or a client component that forgets to re-filter.
 */
export function scopeCoaQuery<T>(query: T, viewer: CoaViewer): T {
  // Retired rows are withdrawn from EVERY reader, including the audit team.
  // They are duplicate parse artefacts, not findings — the row is preserved in
  // the table for reconstruction, but showing it would just reintroduce the
  // ambiguity it was retired to remove.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const live = (query as any).is('retired_at', null);
  if (viewer.elevated) return live as T;
  return live.eq('product_scope', CS_SCOPE) as T;
}
