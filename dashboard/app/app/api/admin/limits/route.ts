// CRUD for the COA limits table. Admin only.
// GET    → list
// POST   → create new limit
// (PATCH/DELETE on individual rows live at /api/admin/limits/[id])

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

export async function GET() {
  const gate = await gateAdmin();
  if (gate.error) return gate.error;
  const adb = supabaseAdmin();
  const { data, error } = await adb
    .from('coa_limits')
    .select('*')
    .order('display_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ limits: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await gateAdmin();
  if (gate.error) return gate.error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const key = String(body.key ?? '').trim();
  const label = String(body.label ?? '').trim();
  const unit = String(body.unit ?? '').trim();
  const category = String(body.category ?? '');
  const direction = String(body.direction ?? '');
  const source = String(body.source ?? '').trim();

  if (!key || !label || !VALID_CATEGORIES.has(category) || !VALID_DIRECTIONS.has(direction) || !source) {
    return NextResponse.json({
      error: 'invalid_payload',
      message: 'key, label, category, direction (ceiling/floor/range), and source are required.',
    }, { status: 400 });
  }

  const value = body.value == null || body.value === '' ? null : Number(body.value);
  const min   = body.min   == null || body.min   === '' ? null : Number(body.min);
  const max   = body.max   == null || body.max   === '' ? null : Number(body.max);

  if (direction === 'range' && (min == null || max == null)) {
    return NextResponse.json({ error: 'range_needs_min_max' }, { status: 400 });
  }
  if ((direction === 'ceiling' || direction === 'floor') && value == null) {
    return NextResponse.json({ error: 'value_required' }, { status: 400 });
  }

  const adb = supabaseAdmin();
  const { data, error } = await adb.from('coa_limits').insert({
    key, label, unit, category, direction, value, min_value: min, max_value: max,
    source,
    notes: body.notes ? String(body.notes) : null,
    display_order: body.display_order != null ? Number(body.display_order) : 0,
    active: body.active === false ? false : true,
    updated_by: gate.user!.id,
  }).select('*').single();
  if (error) {
    if (/duplicate key|unique constraint/i.test(error.message)) {
      return NextResponse.json({ error: 'duplicate_key', message: 'A limit with this key already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  bustLimitsCache();
  return NextResponse.json({ ok: true, limit: data });
}
