// GET /api/heatmap/topic-messages?topic_id=<uuid>
// Editor-only. Returns recent messages tagged with the topic.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: profile } = await sb.from('profiles').select('role').eq('id', auth.user.id).single();
  if (profile?.role !== 'editor') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const topic_id = url.searchParams.get('topic_id');
  if (!topic_id) return NextResponse.json({ error: 'missing_topic_id' }, { status: 400 });

  const adb = supabaseAdmin();

  // Get message_ids tagged with this topic.
  const { data: tagRows, error: tagErr } = await adb
    .from('message_topics')
    .select('message_id')
    .eq('topic_id', topic_id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (tagErr) return NextResponse.json({ error: tagErr.message }, { status: 500 });

  const ids = (tagRows ?? []).map((r) => r.message_id);
  if (!ids.length) return NextResponse.json({ messages: [] });

  const { data: msgs, error: msgErr } = await adb
    .from('messages')
    .select('id, question, answer, user_rating, escalated, insufficient_evidence, confidence_score, created_at')
    .in('id', ids)
    .order('created_at', { ascending: false })
    .limit(50);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  return NextResponse.json({ messages: msgs ?? [] });
}
