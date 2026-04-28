// POST /api/chat/feedback
// Body: { message_id: string; rating: 1 | -1; note?: string }
//
// End-user thumbs-up / thumbs-down on their own answer. Owner-scoped — RLS
// rejects anyone trying to rate someone else's message. Rating is idempotent:
// re-rating the same message overwrites the previous rating.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const message_id: string | undefined = body.message_id;
  const rating = body.rating;
  const note: string | undefined = typeof body.note === 'string' ? body.note.slice(0, 2000) : undefined;

  if (!message_id || (rating !== 1 && rating !== -1)) {
    return NextResponse.json({ error: 'message_id and rating (1 | -1) required' }, { status: 400 });
  }

  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // RLS will also enforce this, but fail early with a clean error if the row
  // doesn't belong to the caller.
  const { data: msg, error: readErr } = await supabase
    .from('messages')
    .select('id, user_id')
    .eq('id', message_id)
    .single();
  if (readErr || !msg) return NextResponse.json({ error: 'message not found' }, { status: 404 });
  if (msg.user_id !== auth.user.id) {
    return NextResponse.json({ error: 'cannot rate another user\'s message' }, { status: 403 });
  }

  const { error: updateErr } = await supabase
    .from('messages')
    .update({
      user_rating: rating,
      user_rating_note: note ?? null,
      user_rated_at: new Date().toISOString(),
    })
    .eq('id', message_id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
