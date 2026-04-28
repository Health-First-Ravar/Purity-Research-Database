// User management — editor only.
//
// GET    /api/editor/users           → list users (profiles joined with auth.users sign-in stats)
// POST   /api/editor/users           → invite a new user by email
//   Body: { email: string; role?: 'user'|'editor'; full_name?: string }
//   Sends a Supabase magic-link invite. When the user clicks, they choose a
//   password and a profile row is upserted with the chosen role.
// PATCH  /api/editor/users?id=<uuid> → change role
//   Body: { role: 'user'|'editor' }

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

const VALID_ROLES = new Set(['customer_service', 'editor', 'admin']);

async function gateEditor() {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  const { data: profile } = await sb.from('profiles').select('role').eq('id', auth.user.id).single();
  if (!isAdmin(profile?.role)) return { error: NextResponse.json({ error: 'editor role required' }, { status: 403 }) };
  return { user: auth.user };
}

export async function GET() {
  const gate = await gateEditor();
  if (gate.error) return gate.error;

  const adb = supabaseAdmin();
  const { data: profiles } = await adb
    .from('profiles')
    .select('id, email, role, full_name, created_at')
    .order('created_at', { ascending: true });

  // Pull last_sign_in_at from auth.users via admin API
  const { data: au } = await adb.auth.admin.listUsers();
  const signInById = new Map<string, string | null>();
  for (const u of au.users ?? []) {
    signInById.set(u.id, u.last_sign_in_at ?? null);
  }

  const users = (profiles ?? []).map((p) => ({
    ...p,
    last_sign_in_at: signInById.get(p.id) ?? null,
  }));

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const gate = await gateEditor();
  if (gate.error) return gate.error;

  let body: { email?: string; role?: string; full_name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }
  const role = body.role && VALID_ROLES.has(body.role) ? body.role : 'customer_service';
  const full_name = body.full_name?.trim() || null;

  const adb = supabaseAdmin();

  // Where the magic-link should drop the user after they accept the invite.
  // Picks up Vercel's deploy URL automatically; falls back to a local dev URL.
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const { data: invited, error: inviteErr } = await adb.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteOrigin}/auth/callback?type=invite`,
  });
  if (inviteErr) {
    // If the user already exists, surface that distinctly so the UI can
    // suggest "edit role" instead.
    if (/already.*registered|already exists/i.test(inviteErr.message)) {
      return NextResponse.json({ error: 'already_exists', message: inviteErr.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'invite_failed', message: inviteErr.message }, { status: 500 });
  }
  if (!invited?.user) {
    return NextResponse.json({ error: 'invite_failed', message: 'Supabase did not return a user.' }, { status: 500 });
  }

  // Upsert the profile with the chosen role. The DB trigger may have already
  // created a default-role profile row; this overwrites with our values.
  const { error: profErr } = await adb.from('profiles').upsert({
    id: invited.user.id,
    email,
    role,
    full_name,
  }, { onConflict: 'id' });
  if (profErr) {
    return NextResponse.json({
      error: 'profile_upsert_failed',
      message: profErr.message,
      invite_sent: true,
      user_id: invited.user.id,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user: { id: invited.user.id, email, role, full_name },
  });
}

export async function DELETE(req: NextRequest) {
  const gate = await gateEditor();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  // Guard: cannot delete yourself
  if (id === gate.user!.id) {
    return NextResponse.json({
      error: 'cannot_delete_self',
      message: 'You cannot delete your own account.',
    }, { status: 409 });
  }

  // Guard: cannot delete the last admin
  const adb = supabaseAdmin();
  const { data: admins } = await adb.from('profiles').select('id').eq('role', 'admin');
  const adminIds = (admins ?? []).map((a) => a.id);
  if (adminIds.length === 1 && adminIds[0] === id) {
    return NextResponse.json({
      error: 'last_admin',
      message: 'Cannot delete the last admin account.',
    }, { status: 409 });
  }

  // Delete from auth.users — the DB trigger cascades to profiles
  const { error } = await adb.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const gate = await gateEditor();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  let body: { role?: string; full_name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  if (body.role && VALID_ROLES.has(body.role)) update.role = body.role;
  if (typeof body.full_name === 'string') update.full_name = body.full_name.trim() || null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no_changes', message: 'Pass role or full_name.' }, { status: 400 });
  }

  // Guard: don't let an admin demote themselves accidentally and lock the system out.
  if (id === gate.user!.id && update.role && update.role !== 'admin') {
    return NextResponse.json({
      error: 'cannot_demote_self',
      message: 'You cannot change your own role. Ask another admin.',
    }, { status: 409 });
  }

  const adb = supabaseAdmin();
  const { error } = await adb.from('profiles').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: Object.keys(update) });
}
