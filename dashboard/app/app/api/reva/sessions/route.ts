// /api/reva/sessions — list / create / patch sessions for the operator.
// Editor-only.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

async function requireEditor() {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { ok: false as const, status: 401, body: { error: 'unauthorized' } };
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  if (!isAdmin(profile?.role)) {
    return { ok: false as const, status: 403, body: { error: 'forbidden' } };
  }
  return { ok: true as const, user_id: auth.user.id };
}

export async function GET() {
  const gate = await requireEditor();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const adb = supabaseAdmin();
  const { data, error } = await adb
    .from('reva_sessions')
    .select('id, title, default_mode, pinned, archived, created_at, updated_at')
    .eq('user_id', gate.user_id)
    .eq('archived', false)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data ?? [] });
}

export async function POST(req: Request) {
  const gate = await requireEditor();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: { title?: string; default_mode?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const default_mode = ['create', 'analyze', 'challenge'].includes(body.default_mode ?? '')
    ? body.default_mode
    : 'analyze';

  const adb = supabaseAdmin();
  const { data, error } = await adb
    .from('reva_sessions')
    .insert({
      user_id: gate.user_id,
      title: (body.title ?? '').trim() || null,
      default_mode,
    })
    .select('id, title, default_mode, pinned, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}

export async function PATCH(req: Request) {
  const gate = await requireEditor();
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  let body: { title?: string; default_mode?: string; pinned?: boolean; archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title.trim() || null;
  if (body.default_mode && ['create', 'analyze', 'challenge'].includes(body.default_mode)) {
    updates.default_mode = body.default_mode;
  }
  if (typeof body.pinned === 'boolean') updates.pinned = body.pinned;
  if (typeof body.archived === 'boolean') updates.archived = body.archived;

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'no_updates' }, { status: 400 });
  }

  const adb = supabaseAdmin();
  const { data, error } = await adb
    .from('reva_sessions')
    .update(updates)
    .eq('id', id)
    .eq('user_id', gate.user_id)
    .select('id, title, default_mode, pinned, archived, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
