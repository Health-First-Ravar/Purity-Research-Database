// GET  /api/reports/mappings  — list rules (any authed user; RLS allows read all)
// POST /api/reports/mappings  — create rule (editor)
// Body: { pattern, pattern_type?: 'contains'|'regex', origin?, region?, notes?, priority? }

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';

export async function GET() {
  const supabase = supabaseServer(await cookies());
  const { data, error } = await supabase
    .from('coa_mapping_rules')
    .select('*')
    .order('priority', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  if (!body.pattern || typeof body.pattern !== 'string') {
    return NextResponse.json({ error: 'pattern required' }, { status: 400 });
  }
  const pattern_type = body.pattern_type === 'regex' ? 'regex' : 'contains';

  const { data, error } = await supabase
    .from('coa_mapping_rules')
    .insert({
      pattern: body.pattern.trim(),
      pattern_type,
      origin: body.origin?.trim() || null,
      region: body.region?.trim() || null,
      notes: body.notes?.trim() || null,
      priority: typeof body.priority === 'number' ? body.priority : 100,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}
