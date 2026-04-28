// Per-limit edit + soft-delete. Admin only.
//
// PATCH  → update any combination of fields
// DELETE → set active=false (soft delete; no row destruction)

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/auth-roles';
import { bustLimitsCache } from '@/lib/coa-limits';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set(['mycotoxin','process_contaminant','heavy_metal','pesticide','quality','bioactive']);
const VALID_DIRECTIONS = new Set(['ceiling','floor','range']);

async function gateAdmin() {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  const { data: profile } = await sb.from('profiles').select('role').eq('id', auth.user.id).single();
  if (!isAdmin(profile?.role)) return { error: NextResponse.json({ error: 'admin role required' }, { status: 403 }) };
  return { user: auth.user };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gate = await gateAdmin();
  if (gate.error) return gate.error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: gate.user!.id,
  };
  if (typeof body.key === 'string') update.key = body.key.trim();
  if (typeof body.label === 'string') update.label = body.label.trim();
  if (typeof body.unit === 'string') update.unit = body.unit.trim();
  if (typeof body.category === 'string' && VALID_CATEGORIES.has(body.category)) update.category = body.category;
  if (typeof body.direction === 'string' && VALID_DIRECTIONS.has(body.direction)) update.direction = body.direction;
  if ('value' in body) update.value = body.value === '' || body.value == null ? null : Number(body.value);
  if ('min'   in body) update.min_value = body.min === '' || body.min == null ? null : Number(body.min);
  if ('max'   in body) update.max_value = body.max === '' || body.max == null ? null : Number(body.max);
  if (typeof body.source === 'string') update.source = body.source.trim();
  if ('notes' in body) update.notes = body.notes ? String(body.notes) : null;
  if ('display_order' in body) update.display_order = body.display_order == null ? 0 : Number(body.display_order);
  if ('active' in body) update.active = !!body.active;

  if (Object.keys(update).length <= 2) {
    return NextResponse.json({ error: 'no_changes' }, { status: 400 });
  }

  const adb = supabaseAdmin();
  const { error } = await adb.from('coa_limits').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  bustLimitsCache();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gate = await gateAdmin();
  if (gate.error) return gate.error;
  const adb = supabaseAdmin();
  const { error } = await adb.from('coa_limits').update({
    active: false,
    updated_at: new Date().toISOString(),
    updated_by: gate.user!.id,
  }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  bustLimitsCache();
  return NextResponse.json({ ok: true });
}
