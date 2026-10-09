// POST /auth/signout: end the session on the server and clear its cookies.
//
// Signing out only in the browser (supabase.auth.signOut() in the client)
// left the session alive in QA: after "Sign out", /claims and /admin still
// loaded signed in and the sb-...-auth-token cookie was still there (another
// open tab's client can also write a refreshed session back). This revokes
// the session with Supabase (all of this user's refresh tokens) and expires
// every Supabase auth cookie on the response, including chunked ones
// (sb-<ref>-auth-token.0, .1, ...).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

export async function POST() {
  const cookieStore = await cookies();
  const res = NextResponse.json({ ok: true });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => res.cookies.set({ name, value, ...options }),
        remove: (name: string, options: CookieOptions) => res.cookies.set({ name, value: '', ...options, maxAge: 0 }),
      },
    },
  );
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) console.error('[auth/signout] signOut:', error.message);
  for (const c of cookieStore.getAll()) {
    if (/^sb-.*-auth-token(?:\.\d+)?$/.test(c.name) || /^sb-.*-auth-token-code-verifier$/.test(c.name)) {
      res.cookies.set({ name: c.name, value: '', path: '/', maxAge: 0 });
    }
  }
  return res;
}
