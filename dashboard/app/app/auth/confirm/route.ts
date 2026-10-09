// /auth/confirm — verifies an emailed one-time token (password reset or
// invite) server side, sets the session cookies, and sends the user to set a
// password. Links come from emailTokenLink() in lib/site-origin.ts.
//
// /auth/confirm?token_hash=...&type=recovery → /auth/update-password
// /auth/confirm?token_hash=...&type=invite   → /auth/update-password

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

const TYPES = ['recovery', 'invite'] as const;
type TokenType = (typeof TYPES)[number];

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const expired = NextResponse.redirect(`${origin}/login?error=invite_expired`);

  if (!tokenHash || !TYPES.includes(type as TokenType)) return expired;

  const response = NextResponse.redirect(`${origin}/auth/update-password`);
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => {
          cookieStore.set(name, value, options);
          response.cookies.set(name, value, options);
        },
        remove: (name: string, options: CookieOptions) => {
          cookieStore.set(name, '', options);
          response.cookies.set(name, '', options);
        },
      },
    },
  );

  const { error } = await supabase.auth.verifyOtp({ type: type as TokenType, token_hash: tokenHash });
  if (error) {
    console.error('[auth/confirm] verifyOtp failed:', error.message);
    return expired;
  }
  return response;
}
