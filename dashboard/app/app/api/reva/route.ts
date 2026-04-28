// POST /api/reva — Ask Reva operator chat. Editor-only.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { askReva, type RevaMode, type RevaPriorTurn } from '@/lib/rag/reva';
import { checkChatRateLimit } from '@/lib/rate-limit';
import { isAdmin } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

const ALLOWED_MODES: RevaMode[] = ['create', 'analyze', 'challenge'];

export async function POST(req: Request) {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Editor-only check
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  if (!isAdmin(profile?.role)) {
    return NextResponse.json({ error: 'forbidden', message: 'Reva is editor-only.' }, { status: 403 });
  }

  let body: { session_id?: string; mode?: string; question?: string; prior?: RevaPriorTurn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const session_id = (body.session_id ?? '').trim();
  const question = (body.question ?? '').trim();
  if (!session_id) return NextResponse.json({ error: 'missing_session_id' }, { status: 400 });
  if (question.length < 2) return NextResponse.json({ error: 'question_too_short' }, { status: 400 });
  if (question.length > 8000) return NextResponse.json({ error: 'question_too_long' }, { status: 400 });

  const mode: RevaMode = ALLOWED_MODES.includes(body.mode as RevaMode)
    ? (body.mode as RevaMode)
    : 'analyze';
  const prior = Array.isArray(body.prior) ? body.prior : [];

  const rl = await checkChatRateLimit(sb);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: rl.reason, retry_after_seconds: rl.retry_after_seconds },
      { status: 429 },
    );
  }

  const adb = supabaseAdmin();

  // Verify the session belongs to this editor (defense in depth on top of RLS).
  const { data: sess, error: sessErr } = await adb
    .from('reva_sessions')
    .select('id, user_id, default_mode')
    .eq('id', session_id)
    .single();
  if (sessErr || !sess || sess.user_id !== auth.user.id) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  }

  // Persist the user turn first.
  await adb.from('reva_messages').insert({
    session_id,
    user_id: auth.user.id,
    role: 'user',
    mode,
    content: question,
  });

  const answer = await askReva({ question, mode, prior });

  // Persist the assistant turn.
  const { data: msgRow } = await adb
    .from('reva_messages')
    .insert({
      session_id,
      user_id: auth.user.id,
      role: 'assistant',
      mode,
      content: answer.answer,
      retrieved_chunk_ids: answer.retrieved_chunk_ids,
      cited_chunk_ids: answer.cited_chunk_ids,
      flags: answer.flags,
      tokens_in: answer.tokens_in,
      tokens_out: answer.tokens_out,
      cost_usd: answer.cost_usd,
      latency_ms: answer.latency_ms,
    })
    .select('id, created_at')
    .single();

  // Touch the session updated_at + bump title if blank
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  await adb.from('reva_sessions').update(updates).eq('id', session_id);

  return NextResponse.json({
    message_id: msgRow?.id,
    created_at: msgRow?.created_at,
    answer: answer.answer,
    mode: answer.mode,
    cited_chunks: answer.cited_chunks,
    flags: answer.flags,
    tokens_in: answer.tokens_in,
    tokens_out: answer.tokens_out,
    cost_usd: answer.cost_usd,
    latency_ms: answer.latency_ms,
  });
}
