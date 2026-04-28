// POST /api/editor/claim
// Body: { message_id: string }
// Editor opens an escalated message. Emits a 'claimed' event (idempotent per
// editor per message — we only emit if the most recent claim wasn't by the
// same editor).

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { hasElevatedAccess } from '@/lib/auth-roles';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const message_id: string | undefined = body.message_id;
  if (!message_id) return NextResponse.json({ error: 'message_id required' }, { status: 400 });

  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) {
    return NextResponse.json({ error: 'editor role required' }, { status: 403 });
  }

  // Skip if this editor already claimed most recently.
  const { data: latest } = await supabase
    .from('escalation_events')
    .select('actor_id, event_type')
    .eq('message_id', message_id)
    .eq('event_type', 'claimed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.actor_id === auth.user.id) {
    return NextResponse.json({ ok: true, skipped: 'already_claimed' });
  }

  const { error } = await supabase.from('escalation_events').insert({
    message_id,
    event_type: 'claimed',
    actor_id: auth.user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
