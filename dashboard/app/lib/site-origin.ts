// Origin used in emailed links (password reset, invites).
//
// Preview deployments link back to the branch URL so a reset started on the
// preview finishes on the preview. Production and local dev keep the old
// behavior: NEXT_PUBLIC_SITE_URL, then the deployment URL, then localhost.
// Never derived from the request's Host header.

export function siteOrigin(): string {
  if (process.env.VERCEL_ENV === 'preview') {
    const host = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
    if (host) return `https://${host}`;
  }
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  );
}

// Link for an emailed one-time token. It points straight at /auth/confirm,
// which verifies the token server side. This replaces Supabase's action_link,
// which redirects with the session in the URL fragment (never seen by the
// server, so /auth/callback treated every reset and invite as expired) and
// falls back to the Site URL when the redirect is not on Supabase's allow list.
export function emailTokenLink(hashedToken: string, type: 'recovery' | 'invite'): string {
  const q = new URLSearchParams({ token_hash: hashedToken, type });
  return `${siteOrigin()}/auth/confirm?${q.toString()}`;
}
