// POST /api/atlas/layout — persist a node's position so the atlas remembers
// arrangement across reloads. Editor-only (RLS handles it; we re-check here).
//
// Body: { node_id: string, x: number, y: number, locked?: boolean }

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // Editor gate — RLS will also block but a clean 403 is friendlier.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  if (!hasElevatedAccess(profile?.role)) {
    return NextResponse.json({ error: 'editor only' }, { status: 403 });
  }

  let body: { node_id?: string; x?: number; y?: number; locked?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const { node_id, x, y, locked } = body;
  if (!node_id || typeof x !== 'number' || typeof y !== 'number') {
    return NextResponse.json({ error: 'node_id, x, y required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('kb_atlas_layout')
    .upsert({
      node_id,
      x, y,
      locked: locked ?? false,
      updated_by: auth.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'node_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
