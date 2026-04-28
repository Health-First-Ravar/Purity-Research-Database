// GET  /api/atlas/unmapped  — list topic_categories that didn't auto-route, with paper counts
// POST /api/atlas/unmapped  — assign a topic to a branch (creates a kb_atlas_topic_routes row)

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { topicToBranchHardcoded } from '../_routing';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const [sourcesRes, routesRes] = await Promise.all([
    supabase.from('sources')
      .select('id, topic_category, chapter, kind, title')
      .is('valid_until', null)
      .in('kind', ['research_paper', 'coffee_book', 'reva_skill', 'purity_brain']),
    supabase.from('kb_atlas_topic_routes').select('topic_pattern, branch_id'),
  ]);
  if (sourcesRes.error) return NextResponse.json({ error: sourcesRes.error.message }, { status: 500 });

  const routes: Record<string, string> = {};
  for (const r of routesRes.data ?? []) routes[r.topic_pattern.toLowerCase()] = r.branch_id;

  const CHAPTER_TO_BRANCH: Record<string, string> = {
    '01': 'b:culture','02': 'b:culture','03': 'b:bioactives','04': 'b:bioactives',
    '06': 'b:roast','07': 'b:contaminant','08': 'b:bioactives',
    '09': 'b:cardiovascular','09.5': 'b:cardiovascular','10': 'b:metabolic',
    '12': 'b:metals','14': 'b:mycotoxin','17': 'b:bioactives','18': 'b:bioactives',
  };

  // Group unmapped sources by topic_category
  const byTopic: Record<string, { count: number; titles: string[] }> = {};
  let nullTopic = 0;
  for (const s of sourcesRes.data ?? []) {
    if (s.chapter && CHAPTER_TO_BRANCH[s.chapter]) continue;
    const t = s.topic_category;
    if (!t) { nullTopic++; continue; }
    if (routes[t.toLowerCase()]) continue;          // editor already routed this exact topic
    if (topicToBranchHardcoded(t)) continue;        // hardcoded regex catches it
    if (!byTopic[t]) byTopic[t] = { count: 0, titles: [] };
    byTopic[t].count++;
    if (byTopic[t].titles.length < 3) byTopic[t].titles.push(s.title ?? '(untitled)');
  }

  const items = Object.entries(byTopic)
    .map(([topic, v]) => ({ topic, count: v.count, sampleTitles: v.titles }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    items,
    totalUnmappedTopics: items.length,
    sourcesWithoutTopic: nullTopic,
  });
}

export async function POST(req: NextRequest) {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) return NextResponse.json({ error: 'editor only' }, { status: 403 });

  let body: { topic?: string; branch_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const { topic, branch_id } = body;
  if (!topic || !branch_id) return NextResponse.json({ error: 'topic + branch_id required' }, { status: 400 });

  const { error } = await supabase.from('kb_atlas_topic_routes').upsert({
    topic_pattern: topic.toLowerCase(),
    branch_id,
    created_by: auth.user.id,
  }, { onConflict: 'topic_pattern' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
