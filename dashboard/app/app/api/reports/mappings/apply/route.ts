// POST /api/reports/mappings/apply — call apply_coa_mapping_rules() RPC.
// Editor-only (the RPC also enforces is_editor()).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';

export async function POST() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data, error } = await supabase.rpc('apply_coa_mapping_rules');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const updated = Array.isArray(data) && data[0]?.updated_count != null ? data[0].updated_count : 0;
  return NextResponse.json({ ok: true, updated });
}
