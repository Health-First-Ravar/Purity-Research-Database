// POST /api/reva-helper — the floating widget endpoint.
// Auth required. Editor flag passes into the system prompt so Reva can
// suggest editor-only tabs only when appropriate.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { askRevaHelper, type HelperPriorTurn } from '@/lib/rag/reva-helper';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  const isEditor = profile?.role === 'editor';

  let body: { question?: string; prior?: HelperPriorTurn[]; current_path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const question = (body.question ?? '').trim();
  if (question.length < 1) return NextResponse.json({ error: 'empty_question' }, { status: 400 });
  if (question.length > 1500) return NextResponse.json({ error: 'question_too_long' }, { status: 400 });

  const prior = Array.isArray(body.prior) ? body.prior.slice(-4) : [];
  const currentPath = body.current_path ? String(body.current_path) : null;

  const r = await askRevaHelper({ question, prior, isEditor, currentPath });

  return NextResponse.json({
    answer: r.answer,
    suggested_tab: r.suggested_tab,
    cost_usd: r.cost_usd,
    latency_ms: r.latency_ms,
  });
}
