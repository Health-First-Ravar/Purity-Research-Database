// POST /api/reports/assign — assign a product/scope to COA rows, or revert.
//
// Editor-only. Every call writes to `coa_assignment_log` with the previous
// values, so any assignment can be reverted exactly.
//
// `dry_run: true` is honoured for every action and returns exactly what would
// change without writing. The UI uses it to render the confirmation step, so
// what a reviewer approves is computed by the same code path that applies it —
// not a second implementation that can drift.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { hasElevatedAccess } from '@/lib/auth-roles';
import { BLEND_KEYS } from '@/lib/coa-assign';

type Body = {
  action?: 'assign' | 'revert' | 'skip';
  ids?: string[];
  blend?: string | null;
  /** Scope to set. Only 'purity' or 'unclassified' — competitor is not an
   *  assignment decision, it is a classification the backfill makes. */
  product_scope?: 'purity' | 'unclassified';
  note?: string;
  dry_run?: boolean;
};

export async function POST(req: NextRequest) {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  const actorEmail = auth.user.email ?? null; // snapshot: outlives the account
  if (!hasElevatedAccess(profile?.role)) {
    return NextResponse.json({ error: 'editor role required' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const action = body.action ?? 'assign';
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  const dryRun = body.dry_run !== false; // default to dry run — writing is opt-in

  if (ids.length === 0) return NextResponse.json({ error: 'no ids supplied' }, { status: 400 });
  if (ids.length > 500) return NextResponse.json({ error: 'too many ids in one call (max 500)' }, { status: 400 });

  const adb = supabaseAdmin();

  // Current state, needed for the log's previous values and for the preview.
  const { data: current, error: readErr } = await adb
    .from('coas')
    .select('id, report_number, coffee_name, blend, product_scope, assigned_by, assigned_at')
    .in('id', ids);
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!current?.length) return NextResponse.json({ error: 'no matching rows' }, { status: 404 });

  // ---- revert -------------------------------------------------------------
  if (action === 'revert') {
    const { data: logs } = await adb
      .from('coa_assignment_log')
      .select('*')
      .in('coa_id', ids)
      .eq('action', 'assign')
      .order('created_at', { ascending: false });

    const latestByCoa = new Map<string, Record<string, unknown>>();
    for (const l of logs ?? []) if (!latestByCoa.has(l.coa_id as string)) latestByCoa.set(l.coa_id as string, l);

    const plan = [...latestByCoa.values()].map((l) => ({
      coa_id: l.coa_id,
      restore_blend: l.prev_blend,
      restore_scope: l.prev_product_scope,
    }));
    if (dryRun) return NextResponse.json({ dry_run: true, action, would_revert: plan.length, plan });

    let ok = 0;
    for (const p of plan) {
      const before = current.find((c) => c.id === p.coa_id);
      const { error } = await adb.from('coas')
        .update({
          blend: p.restore_blend,
          product_scope: p.restore_scope,
          assigned_by: null,
          assigned_at: null,
        })
        .eq('id', p.coa_id as string);
      if (error) continue;
      await adb.from('coa_assignment_log').insert({
        coa_id: p.coa_id,
        prev_blend: before?.blend ?? null,
        prev_product_scope: before?.product_scope ?? null,
        new_blend: p.restore_blend,
        new_product_scope: p.restore_scope,
        action: 'revert',
        note: body.note ?? null,
        actor: auth.user.id,
        actor_email: actorEmail,
      });
      ok++;
    }
    return NextResponse.json({ reverted: ok });
  }

  // ---- skip (record that a human looked and declined to decide) -----------
  if (action === 'skip') {
    if (dryRun) return NextResponse.json({ dry_run: true, action, would_skip: current.length });
    const rows = current.map((c) => ({
      coa_id: c.id,
      prev_blend: c.blend, prev_product_scope: c.product_scope,
      new_blend: c.blend, new_product_scope: c.product_scope,
      action: 'skip', note: body.note ?? null, actor: auth.user.id, actor_email: actorEmail,
    }));
    const { error } = await adb.from('coa_assignment_log').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ skipped: rows.length });
  }

  // ---- assign -------------------------------------------------------------
  const blend = body.blend ?? null;
  const scope = body.product_scope ?? 'purity';

  if (blend !== null && !BLEND_KEYS.includes(blend)) {
    return NextResponse.json(
      { error: `unknown blend "${blend}". Known: ${BLEND_KEYS.join(', ')}` },
      { status: 400 },
    );
  }
  if (scope !== 'purity' && scope !== 'unclassified') {
    return NextResponse.json({ error: 'product_scope must be purity or unclassified' }, { status: 400 });
  }

  // Scope consequence, computed here so the preview and the write agree.
  const becomingVisible = current.filter((c) => c.product_scope !== 'purity' && scope === 'purity');
  const alreadyAssigned = current.filter((c) => c.assigned_by !== null);

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      action: 'assign',
      would_update: current.length,
      blend,
      product_scope: scope,
      becoming_cs_visible: becomingVisible.length,
      becoming_cs_visible_examples: becomingVisible.slice(0, 5).map((c) => ({
        report_number: c.report_number, coffee_name: c.coffee_name,
      })),
      already_assigned_will_be_overwritten: alreadyAssigned.length,
      rows: current.map((c) => ({
        id: c.id, report_number: c.report_number, coffee_name: c.coffee_name,
        from: { blend: c.blend, product_scope: c.product_scope },
        to: { blend, product_scope: scope },
      })),
    });
  }

  let ok = 0;
  const failures: string[] = [];
  for (const c of current) {
    const { error } = await adb.from('coas')
      .update({
        blend,
        product_scope: scope,
        assigned_by: auth.user.id,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', c.id);
    if (error) { failures.push(`${c.report_number}: ${error.message}`); continue; }
    await adb.from('coa_assignment_log').insert({
      coa_id: c.id,
      prev_blend: c.blend, prev_product_scope: c.product_scope,
      new_blend: blend, new_product_scope: scope,
      action: 'assign', note: body.note ?? null, actor: auth.user.id, actor_email: actorEmail,
    });
    ok++;
  }

  return NextResponse.json({
    assigned: ok,
    became_cs_visible: becomingVisible.length,
    failures: failures.length ? failures : undefined,
  });
}
