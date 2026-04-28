// Role checks consolidated. Three levels (with legacy aliasing):
//
//   admin            — full access. Only role that sees Users, Metrics, Ask Reva.
//   editor           — back-office. Reports, Bibliography, Audit, Atlas,
//                      Heatmap, Canon, Editor queue.
//                      Explicitly NOT: Research Hub (chat), Ask Reva, Users, Metrics.
//   customer_service — Research Hub (chat), Reports, Bibliography, Audit only.
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

/** Customer-facing chat (Research Hub). Allowed for customer_service and admin only — NOT editor. */
export function canChat(role: DbRole): boolean {
  return role === 'admin' || role === 'customer_service' || role === 'user';
}
