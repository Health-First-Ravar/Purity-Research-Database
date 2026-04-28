// POST /api/editor/canon/[id]
// Body: { action: 'approve' | 'reject'; question?: string; answer?: string }
//   For draft rows only — approve / reject the original review action.
//
// PATCH /api/editor/canon/[id]
// Body: { question?: string; answer?: string; status?: 'active'|'deprecated'|'draft'; tags?: string[] }
//   Edit any canon_qa row regardless of current status. Re-embeds the question
//   if it changed. Use this to fix typos in active canon, deprecate a stale
//   answer, or restore a deprecated row to active.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { embedOne } from '@/lib/voyage';
import { hasElevatedAccess } from '@/lib/auth-roles';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action: 'approve' | 'reject' | undefined = body.action;
  const editedQuestion: string | undefined = body.question;
  const editedAnswer: string | undefined = body.answer;

  if (!action || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
  }

  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) {
    return NextResponse.json({ error: 'editor role required' }, { status: 403 });
  }

  // Fetch the current draft
  const { data: draft, error: fetchErr } = await supabase
    .from('canon_qa')
    .select('id, question, answer, status, origin_message_id')
    .eq('id', id)
    .single();
  if (fetchErr || !draft) return NextResponse.json({ error: 'draft not found' }, { status: 404 });
  if (draft.status !== 'draft') {
    return NextResponse.json({ error: `cannot act on a ${draft.status} row` }, { status: 409 });
  }

  if (action === 'reject') {
    const { error: rejectErr } = await supabase
      .from('canon_qa')
      .update({ status: 'deprecated', reviewed_by: auth.user.id, last_reviewed_at: new Date().toISOString() })
      .eq('id', id);
    if (rejectErr) return NextResponse.json({ error: rejectErr.message }, { status: 500 });

    if (draft.origin_message_id) {
      await supabase.from('escalation_events').insert({
        message_id: draft.origin_message_id,
        event_type: 'rejected',
        actor_id: auth.user.id,
        canon_id: id,
      });
    }

    return NextResponse.json({ ok: true, status: 'deprecated' });
  }

  // approve
  const finalQuestion = editedQuestion?.trim() || draft.question;
  const finalAnswer   = editedAnswer?.trim()   || draft.answer;
  const questionChanged = finalQuestion !== draft.question;

  let embedUpdate: Record<string, unknown> = {};
  if (questionChanged) {
    const vec = await embedOne(finalQuestion, 'document');
    embedUpdate = { question_embed: vec as unknown as string };
  }

  const { error: approveErr } = await supabase
    .from('canon_qa')
    .update({
      question: finalQuestion,
      answer: finalAnswer,
      status: 'active',
      reviewed_by: auth.user.id,
      last_reviewed_at: new Date().toISOString(),
      ...embedUpdate,
    })
    .eq('id', id);
  if (approveErr) return NextResponse.json({ error: approveErr.message }, { status: 500 });

  if (draft.origin_message_id) {
    await supabase.from('escalation_events').insert({
      message_id: draft.origin_message_id,
      event_type: 'promoted',
      actor_id: auth.user.id,
      canon_id: id,
    });
  }

  return NextResponse.json({ ok: true, status: 'active' });
}

// PATCH — edit any canon_qa row, including active ones. Editor only.
// Re-embeds the question if it changed.
const VALID_STATUSES = new Set(['draft', 'active', 'deprecated']);
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) {
    return NextResponse.json({ error: 'editor role required' }, { status: 403 });
  }

  let body: { question?: string; answer?: string; status?: string; tags?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const { data: row, error: fetchErr } = await supabase
    .from('canon_qa')
    .select('id, question, answer, status, origin_message_id')
    .eq('id', id)
    .single();
  if (fetchErr || !row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const update: Record<string, unknown> = {
    last_reviewed_at: new Date().toISOString(),
    reviewed_by: auth.user.id,
  };

  let questionChanged = false;
  if (typeof body.question === 'string' && body.question.trim() && body.question.trim() !== row.question) {
    update.question = body.question.trim();
    questionChanged = true;
  }
  if (typeof body.answer === 'string' && body.answer.trim() && body.answer.trim() !== row.answer) {
    update.answer = body.answer.trim();
  }
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    update.status = body.status;
  }
  if (Array.isArray(body.tags)) {
    update.tags = body.tags.map(String).filter(Boolean);
  }

  // No actual change requested
  const meaningfulKeys = Object.keys(update).filter((k) => !['last_reviewed_at', 'reviewed_by'].includes(k));
  if (meaningfulKeys.length === 0) {
    return NextResponse.json({ error: 'no_changes', message: 'Pass at least one of question, answer, status, tags.' }, { status: 400 });
  }

  if (questionChanged) {
    const vec = await embedOne(update.question as string, 'document');
    update.question_embed = vec as unknown as string;
  }

  const { error } = await supabase.from('canon_qa').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit
  if (row.origin_message_id) {
    await supabase.from('escalation_events').insert({
      message_id: row.origin_message_id,
      event_type: 'edited',
      actor_id: auth.user.id,
      canon_id: id,
    });
  }

  return NextResponse.json({ ok: true, updated: meaningfulKeys });
}
