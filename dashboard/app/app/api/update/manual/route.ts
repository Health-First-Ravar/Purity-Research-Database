// POST /api/update/manual — manual-update button. Editor-only.
// Enforces global 3/day cap via canTrigger RPC, then runs the shared updater.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { runSync } from '@/lib/sync';
import { hasElevatedAccess } from '@/lib/auth-roles';

export async function POST() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) {
    return NextResponse.json({ error: 'editor role required' }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { data: allowed } = await admin.rpc('can_trigger_manual_update');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Global manual-update cap (3/day) reached. Try after midnight UTC.' },
      { status: 429 },
    );
  }

  const result = await runSync({ trigger: 'manual', triggered_by: auth.user.id });
  return NextResponse.json(result);
}
