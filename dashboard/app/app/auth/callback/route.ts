// /auth/callback — exchanges the PKCE code that Supabase appends to the
// redirectTo URL and sends the user to the right place.
//
// Invite flow:   /auth/callback?code=...&type=invite   → /auth/update-password
// Recovery flow: /auth/callback?code=...&type=recovery → /auth/update-password
// Normal flow:   /auth/callback?code=...&next=/chat    → /chat (or next param)

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/chat';
  const type = searchParams.get('type'); // 'invite' | 'recovery' | undefined

  if (code) {
    // Build the redirect response first so we can attach cookies to it.
    const needsPasswordSet = type === 'invite' || type === 'recovery';
    const redirectPath = needsPasswordSet ? '/auth/update-password' : next;
    const response = NextResponse.redirect(`${origin}${redirectPath}`);

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          // Write to both the cookie store and the outgoing redirect response
          // so the session is available immediately on the next request.
          set: (name, value, options) => {
            cookieStore.set(name, value, options);
            response.cookies.set(name, value, options);
          },
          remove: (name, options) => {
            cookieStore.set(name, '', options);
            response.cookies.set(name, '', options);
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }

  // Code missing or exchange failed — send to login with an error hint.
  return NextResponse.redirect(`${origin}/login?error=invite_expired`);
}
