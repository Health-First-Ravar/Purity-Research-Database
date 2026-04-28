// GET /api/atlas/candidates?status=pending
//   List cross-link candidates surfaced by the discovery job.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status') ?? 'pending';
  const { data, error } = await supabase
    .from('kb_atlas_edge_candidates')
    .select('id, source_node_id, target_node_id, similarity, rationale_draft, status')
    .eq('status', status)
    .order('similarity', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ candidates: data ?? [] });
}
