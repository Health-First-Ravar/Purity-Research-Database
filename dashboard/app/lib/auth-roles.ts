// Role checks consolidated. Three levels (with legacy aliasing):
//
//   admin            : full access. Only role that sees Users, Metrics and
//                      Ask deep mode (/reva).
//   editor           : everything customer_service has, plus green lots,
//                      Browse by topic, the Admin tools (Review queue, Canon
//                      answers, Question trends, Sync status) and Manual update.
//   customer_service : Home, Ask, COA quick view (finished products), Claims,
//                      Research library (Papers).
//
// Legacy:
//   'user'       → treat as customer_service
//   'researcher' → treat as editor (collapsed in migration 0018)

export type DbRole = string | null | undefined;

/** Strict admin gate — admin role only. Used for Users, Metrics, Ask Reva. */
export function isAdmin(role: DbRole): boolean {
  return role === 'admin';
}

/** Elevated content access — admin OR editor. Used for Atlas, Heatmap, Canon, Editor queue, Reports mappings, Atlas triage. */
export function hasElevatedAccess(role: DbRole): boolean {
  return role === 'admin' || role === 'editor';
}

/**
 * Ask (/chat). Everyone, per the Research Hub overhaul plan (2026-10-03):
 * editors were excluded when chat was customer-service only; Ask now also
 * answers research and COA questions. Deep mode (Reva) stays admin only.
 */
export function canChat(role: DbRole): boolean {
  return role === 'admin' || role === 'editor' || role === 'researcher' || role === 'customer_service' || role === 'user';
}
