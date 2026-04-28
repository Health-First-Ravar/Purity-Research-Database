// POST /api/atlas/candidates/discover
//   Editor-only. Scans the corpus for cross-branch chunk similarity above
//   a threshold, drafts a rationale via Sonnet, writes pending candidates.
//
// Strategy:
//   1. Gather chunks per branch (via sources → routing).
//   2. For each unrelated branch pair (A, B) where no edge already exists,
//      sample up to 60 chunks per side and compute pairwise cosine via SQL.
//   3. Top 1 chunk-pair per branch-pair, if similarity > THRESHOLD, ask Sonnet
//      to write a 1-sentence rationale grounded in those two chunks.
//   4. Upsert into kb_atlas_edge_candidates (pending).
//
// Designed to run in seconds for the current corpus (~250 papers, 800 chunks).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { topicToBranchHardcoded } from '../../_routing';
import { anthropic, MODEL_CLASSIFY } from '@/lib/anthropic';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SIM_THRESHOLD = 0.78;
const MAX_CANDIDATES = 30;

type Chunk = { id: string; source_id: string; content: string; embedding: string; branchId?: string };

const CHAPTER_TO_BRANCH: Record<string, string> = {
  '01': 'b:culture','02': 'b:culture','03': 'b:bioactives','04': 'b:bioactives',
  '06': 'b:roast','07': 'b:contaminant','08': 'b:bioactives',
  '09': 'b:cardiovascular','09.5': 'b:cardiovascular','10': 'b:metabolic',
  '12': 'b:metals','14': 'b:mycotoxin','17': 'b:bioactives','18': 'b:bioactives',
};

export async function POST() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) return NextResponse.json({ error: 'editor only' }, { status: 403 });

  // Service-role client for the heavy reads (RLS would otherwise gate chunks for non-editors,
  // but here the caller IS an editor — service role just keeps queries simple).
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  // 1) routing tables: editor routes + branches
  const [routesRes, edgesRes] = await Promise.all([
    sb.from('kb_atlas_topic_routes').select('topic_pattern, branch_id'),
    sb.from('kb_atlas_edges').select('source_node_id, target_node_id'),
  ]);
  const editorRoutes: Record<string, string> = {};
  for (const r of routesRes.data ?? []) editorRoutes[r.topic_pattern.toLowerCase()] = r.branch_id;

  const existingPairs = new Set<string>();
  for (const e of edgesRes.data ?? []) {
    existingPairs.add(`${e.source_node_id}|${e.target_node_id}`);
    existingPairs.add(`${e.target_node_id}|${e.source_node_id}`);
  }

  // 2) sources → branch
  const { data: sources } = await sb
    .from('sources')
    .select('id, chapter, topic_category')
    .is('valid_until', null)
    .in('kind', ['research_paper', 'coffee_book', 'reva_skill', 'purity_brain']);

  const sourceToBranch: Record<string, string> = {};
  for (const s of sources ?? []) {
    const b = (s.chapter && CHAPTER_TO_BRANCH[s.chapter])
      || (s.topic_category && editorRoutes[s.topic_category.toLowerCase()])
      || topicToBranchHardcoded(s.topic_category);
    if (b) sourceToBranch[s.id] = b;
  }

  // 3) chunks for those sources (cap to keep this fast)
  const sourceIds = Object.keys(sourceToBranch);
  if (sourceIds.length === 0) {
    return NextResponse.json({ ok: true, candidates: 0, note: 'no routed sources to scan' });
  }
  const { data: chunks } = await sb
    .from('chunks')
    .select('id, source_id, content, embedding')
    .in('source_id', sourceIds)
    .limit(2000);

  const branchChunks: Record<string, Chunk[]> = {};
  for (const c of (chunks ?? []) as Chunk[]) {
    const b = sourceToBranch[c.source_id];
    if (!b) continue;
    c.branchId = b;
    if (!branchChunks[b]) branchChunks[b] = [];
    if (branchChunks[b].length < 60) branchChunks[b].push(c);
  }

  // 4) Pairwise: pick top similarity per branch-pair using server-side cosine.
  //    We use the match_chunks RPC for one chunk at a time (would be expensive),
  //    so instead we approximate: compute similarity for each chunk in branch A
  //    against branch B's chunks via local cosine on the parsed embedding strings.
  //
  //    For corpus this size this is fine in JS — embeddings are 1024-dim and
  //    we have <2000 chunks total.

  type Vec = number[];
  function parseVec(s: string): Vec {
    // pgvector returns "[0.1,0.2,...]" as text via supabase-js
    if (typeof s !== 'string') return s as unknown as number[];
    return JSON.parse(s);
  }
  function cosine(a: Vec, b: Vec): number {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  // Pre-parse vectors once
  const parsed: Record<string, Array<{ id: string; content: string; vec: Vec }>> = {};
  for (const [b, list] of Object.entries(branchChunks)) {
    parsed[b] = list.map((c) => ({ id: c.id, content: c.content, vec: parseVec(c.embedding) }));
  }

  const branchKeys = Object.keys(parsed);
  type Cand = { a: string; b: string; sim: number; chunkA: { id: string; content: string }; chunkB: { id: string; content: string } };
  const candidates: Cand[] = [];

  for (let i = 0; i < branchKeys.length; i++) {
    for (let j = i + 1; j < branchKeys.length; j++) {
      const A = branchKeys[i], B = branchKeys[j];
      if (existingPairs.has(`${A}|${B}`)) continue;
      let best = { sim: -1, chunkA: parsed[A][0], chunkB: parsed[B][0] };
      for (const ca of parsed[A]) {
        for (const cb of parsed[B]) {
          const s = cosine(ca.vec, cb.vec);
          if (s > best.sim) best = { sim: s, chunkA: ca, chunkB: cb };
        }
      }
      if (best.sim >= SIM_THRESHOLD) {
        candidates.push({
          a: A, b: B, sim: best.sim,
          chunkA: { id: best.chunkA.id, content: best.chunkA.content },
          chunkB: { id: best.chunkB.id, content: best.chunkB.content },
        });
      }
    }
  }

  candidates.sort((x, y) => y.sim - x.sim);
  const top = candidates.slice(0, MAX_CANDIDATES);

  // 5) Draft rationales via Sonnet — short prompt, one sentence each
  const drafted: Array<{ a: string; b: string; sim: number; rationale: string; evidence: string[] }> = [];
  for (const c of top) {
    let rationale = `Chunk-similarity ${c.sim.toFixed(3)} suggests an unstated relationship.`;
    try {
      const res = await anthropic.messages.create({
        model: MODEL_CLASSIFY,    // Haiku — fast + cheap
        max_tokens: 120,
        system: 'You write 1-sentence cross-domain rationales linking two coffee-research branches. Plain English, no hedging, no "may potentially" — state the connection. Under 25 words.',
        messages: [{
          role: 'user',
          content: `Branch A: "${branchLabelFromId(c.a)}"
Excerpt: "${c.chunkA.content.slice(0, 600)}"

Branch B: "${branchLabelFromId(c.b)}"
Excerpt: "${c.chunkB.content.slice(0, 600)}"

Write one sentence linking these branches, grounded in both excerpts.`,
        }],
      });
      const text = res.content
        .filter((x) => x.type === 'text')
        .map((x) => (x as { text: string }).text)
        .join(' ')
        .trim();
      if (text) rationale = text.replace(/^["']|["']$/g, '');
    } catch {
      // keep fallback
    }
    drafted.push({ a: c.a, b: c.b, sim: c.sim, rationale, evidence: [c.chunkA.id, c.chunkB.id] });
  }

  // 6) Upsert candidates
  for (const d of drafted) {
    await sb.from('kb_atlas_edge_candidates').upsert({
      source_node_id: d.a,
      target_node_id: d.b,
      similarity: d.sim,
      rationale_draft: d.rationale,
      evidence_chunks: d.evidence,
      status: 'pending',
    }, { onConflict: 'source_node_id,target_node_id' });
  }

  return NextResponse.json({
    ok: true,
    scanned: { branches: branchKeys.length, chunks: (chunks ?? []).length },
    candidates: drafted.length,
  });
}

function branchLabelFromId(id: string): string {
  const m: Record<string, string> = {
    'b:mycotoxin': 'Mycotoxin science',
    'b:bioactives': 'Bioactives',
    'b:contaminant': 'Process contaminants',
    'b:metals': 'Heavy metals',
    'b:roast': 'Roast chemistry',
    'b:brew': 'Brewing & extraction',
    'b:culture': 'Coffee culture',
    'b:agriculture': 'Agriculture',
    'b:soil': 'Soil biology',
    'b:sourcing': 'Sourcing & sustainability',
    'b:process': 'Processing',
    'b:performance': 'Performance & ergogenics',
    'b:mechanism': 'Mechanism & pharmacology',
    'b:cardiovascular': 'Cardiovascular',
    'b:metabolic': 'Metabolic & endocrine',
    'b:oncology': 'Oncology',
    'b:neurological': 'Neurological',
    'b:hepatic': 'Hepatic & digestive',
    'b:musculoskeletal': 'Musculoskeletal',
    'b:reproductive': 'Reproductive health',
    'b:immune': 'Immune & inflammation',
    'b:longevity': 'Longevity & mortality',
    'b:sensory': 'Sensory & skin',
    'b:renal': 'Renal & urinary',
  };
  return m[id] ?? id;
}
