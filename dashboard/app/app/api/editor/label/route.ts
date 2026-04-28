// POST /api/editor/label
// Editor action on a logged message. Labels: 'good' | 'bad' | 'promote_to_canon'.
// 'promote_to_canon' also writes a canon_qa row (status='draft' so the editor can
// review it in the canon queue before flipping to 'active').

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { embedOne } from '@/lib/voyage';
import { hasElevatedAccess } from '@/lib/auth-roles';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const message_id: string | undefined = body.message_id;
  const label: 'good' | 'bad' | 'promote_to_canon' | undefined = body.label;
  const note: string | undefined = body.note;
  const overrides: { question?: string; answer?: string; freshness_tier?: 'stable' | 'weekly' | 'batch' } =
    body.overrides ?? {};

  if (!message_id || !label) {
    return NextResponse.json({ error: 'message_id and label required' }, { status: 400 });
  }

  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  if (!hasElevatedAccess(profile?.role)) {
    return NextResponse.json({ error: 'editor role required' }, { status: 403 });
  }

  // Write the label on the message
  const { error: updateErr } = await supabase
    .from('messages')
    .update({
      editor_label: label,
      editor_note: note ?? null,
      editor_id: auth.user.id,
    })
    .eq('id', message_id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  if (label !== 'promote_to_canon') {
    return NextResponse.json({ ok: true });
  }

  // Promote: fetch message, build canon row
  const { data: msg, error: readErr } = await supabase
    .from('messages')
    .select('question, answer, cited_chunk_ids, classification')
    .eq('id', message_id)
    .single();
  if (readErr || !msg) return NextResponse.json({ error: 'message not found' }, { status: 404 });

  const question = overrides.question ?? msg.question;
  const answer   = overrides.answer   ?? msg.answer ?? '';
  const freshness_tier = overrides.freshness_tier ?? 'stable';

  const question_embed = await embedOne(question, 'document');

  const { data: canonRow, error: canonErr } = await supabase
    .from('canon_qa')
    .insert({
      question,
      answer,
      question_embed: question_embed as unknown as string,
      tags: msg.classification ? [msg.classification] : [],
      freshness_tier,
      scope: 'global',
      cited_chunk_ids: msg.cited_chunk_ids ?? [],
      status: 'draft',
      created_by: auth.user.id,
      origin_message_id: message_id,
    })
    .select('id')
    .single();
  if (canonErr) return NextResponse.json({ error: canonErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, canon_id: canonRow?.id });
}
