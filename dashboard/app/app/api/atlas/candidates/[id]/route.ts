// POST /api/atlas/candidates/[id]
//   Body: { action: 'approve' | 'dismiss' }
//   Approve → insert into kb_atlas_edges + mark candidate approved.
//   Dismiss → mark candidate dismissed (kept for audit).

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) return NextResponse.json({ error: 'editor only' }, { status: 403 });

  const { id } = await ctx.params;
  let body: { action?: 'approve' | 'dismiss' };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const action = body.action;
  if (action !== 'approve' && action !== 'dismiss') {
    return NextResponse.json({ error: 'action must be approve or dismiss' }, { status: 400 });
  }

  const { data: cand, error: candErr } = await supabase
    .from('kb_atlas_edge_candidates')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (candErr || !cand) return NextResponse.json({ error: candErr?.message ?? 'not found' }, { status: 404 });

  if (action === 'approve') {
    // Insert into kb_atlas_edges as a cross link
    const { error: insErr } = await supabase.from('kb_atlas_edges').insert({
      source_node_id: cand.source_node_id,
      target_node_id: cand.target_node_id,
      edge_kind: 'cross',
      rationale: cand.rationale_draft,
      weight: Math.min(0.9, Math.max(0.3, Number(cand.similarity) * 0.9)),
      created_by: auth.user.id,
    });
    if (insErr && !insErr.message.includes('duplicate')) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  await supabase
    .from('kb_atlas_edge_candidates')
    .update({
      status: action === 'approve' ? 'approved' : 'dismissed',
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);

  return NextResponse.json({ ok: true });
}
