// PATCH/DELETE /api/reports/mappings/[id] — editor-only via RLS

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const update: Record<string, unknown> = {};
  if ('pattern' in body) update.pattern = String(body.pattern).trim();
  if ('pattern_type' in body) update.pattern_type = body.pattern_type === 'regex' ? 'regex' : 'contains';
  if ('origin' in body) update.origin = body.origin?.trim() || null;
  if ('region' in body) update.region = body.region?.trim() || null;
  if ('notes' in body) update.notes = body.notes?.trim() || null;
  if ('priority' in body && typeof body.priority === 'number') update.priority = body.priority;
  update.updated_at = new Date().toISOString();

  const { error } = await supabase.from('coa_mapping_rules').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { error } = await supabase.from('coa_mapping_rules').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
