// GET /api/metrics?days=30
// Editor-only. Returns daily rollups from the daily_chat_metrics view plus
// headline totals over the window.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { isAdmin } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!isAdmin(profile?.role)) {
    return NextResponse.json({ error: 'editor role required' }, { status: 403 });
  }

  const daysRaw = Number(req.nextUrl.searchParams.get('days') ?? 30);
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: daily, error: dailyErr } = await supabase
    .from('daily_chat_metrics')
    .select('*')
    .gte('day', since.slice(0, 10))
    .order('day', { ascending: false });
  if (dailyErr) return NextResponse.json({ error: dailyErr.message }, { status: 500 });

  // Promotion candidates + canon misses counts, for the header tiles.
  const [{ count: promoCount }, { count: missesCount }, { count: escCount }] = await Promise.all([
    supabase.from('promotion_candidates').select('message_id', { count: 'exact', head: true }),
    supabase.from('canon_misses').select('message_id', { count: 'exact', head: true }),
    supabase.from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('escalated', true)
      .is('editor_label', null),
  ]);

  const totals = (daily ?? []).reduce(
    (acc, d) => ({
      messages: acc.messages + (d.total_messages ?? 0),
      canon_hits: acc.canon_hits + (d.canon_hits ?? 0),
      llm_calls: acc.llm_calls + (d.llm_calls ?? 0),
      escalations: acc.escalations + (d.escalations ?? 0),
      thumbs_up: acc.thumbs_up + (d.thumbs_up ?? 0),
      thumbs_down: acc.thumbs_down + (d.thumbs_down ?? 0),
      cost_usd: acc.cost_usd + Number(d.total_cost_usd ?? 0),
    }),
    { messages: 0, canon_hits: 0, llm_calls: 0, escalations: 0, thumbs_up: 0, thumbs_down: 0, cost_usd: 0 },
  );

  return NextResponse.json({
    window_days: days,
    totals,
    canon_hit_rate: totals.messages > 0 ? totals.canon_hits / totals.messages : null,
    escalation_rate: totals.messages > 0 ? totals.escalations / totals.messages : null,
    thumbs_up_rate:
      totals.thumbs_up + totals.thumbs_down > 0
        ? totals.thumbs_up / (totals.thumbs_up + totals.thumbs_down)
        : null,
    pending_promotions: promoCount ?? 0,
    canon_misses_count: missesCount ?? 0,
    open_escalations: escCount ?? 0,
    daily: daily ?? [],
  });
}
