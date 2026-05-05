// POST /api/auth/forgot-password
//
// Generates a Supabase password-recovery link server-side (service role),
// then sends it via Resend so the email is fully branded and not rate-limited
// by Supabase's built-in mailer.
//
// Body: { email: string }
// Always returns 200 regardless of whether the email exists (prevents
// user enumeration). Actual errors are logged server-side only.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendPasswordResetEmail } from '@/lib/email';

const OK = NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  let email: string;
  try {
    const body = await req.json();
    email = (body.email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const siteOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  try {
    const adb = supabaseAdmin();
    const { data, error } = await adb.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${siteOrigin}/auth/callback?type=recovery` },
    });

    if (error) {
      // User likely doesn't exist — return OK anyway to prevent enumeration.
      console.error('[forgot-password] generateLink error:', error.message);
      return OK;
    }

    const resetUrl = data.properties.action_link;
    await sendPasswordResetEmail(email, resetUrl);
  } catch (e) {
    // Log but don't surface — same generic OK response.
    console.error('[forgot-password] send error:', e instanceof Error ? e.message : e);
  }

  return OK;
}
