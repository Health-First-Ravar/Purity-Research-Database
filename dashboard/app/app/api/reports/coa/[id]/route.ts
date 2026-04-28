// PATCH /api/reports/coa/[id]
// Editor-only. Update origin/region on a single COA row.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { hasElevatedAccess } from '@/lib/auth-roles';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

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

  const update: Record<string, string | null> = {};
  if ('origin' in body) update.origin = typeof body.origin === 'string' && body.origin.trim() ? body.origin.trim() : null;
  if ('region' in body) update.region = typeof body.region === 'string' && body.region.trim() ? body.region.trim() : null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { error } = await supabase.from('coas').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
