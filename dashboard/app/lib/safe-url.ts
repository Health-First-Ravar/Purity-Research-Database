// Links that come from data (Brian's tracker, Drive, claim placements) are only
// rendered when they are http(s) or an in-app path, so a stored `javascript:`
// or `data:` URL can never become a clickable link.
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  // In-app path only: "//host" and "/\\host" are treated as other hosts by browsers.
  if (u.startsWith('/') && !/^\/[\/\\]/.test(u)) return u;
  return /^https?:\/\//i.test(u) ? u : null;
}
