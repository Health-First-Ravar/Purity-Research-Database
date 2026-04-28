// GET /api/atlas — returns the full graph for the Knowledge Atlas page.
//
// Shape:
//   { branches: [...], papers: [...], edges: [...], layout: {...} }
//
// Branches and edges live in their own tables (kb_atlas_branches /
// kb_atlas_edges). Papers come from `sources` joined with chapter / topic_category
// → branch routing logic kept here so the taxonomy can evolve without migrations.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type SourceRow = {
  id: string;
  title: string | null;
  kind: string | null;
  chapter: string | null;
  topic_category: string | null;
  doi: string | null;
};

// Chapter number (matches sources.chapter) → branch id. Best-guess mapping
// from the book's chapter taxonomy. Editors can refine via topic_category later.
const CHAPTER_TO_BRANCH: Record<string, string> = {
  '01': 'b:culture',
  '02': 'b:culture',
  '03': 'b:bioactives',     // CGAs / bioactives
  '04': 'b:bioactives',
  '06': 'b:roast',
  '07': 'b:contaminant',    // acrylamide
  '08': 'b:bioactives',
  '09': 'b:cardiovascular',
  '09.5': 'b:cardiovascular',
  '10': 'b:metabolic',
  '12': 'b:metals',
  '14': 'b:mycotoxin',
  '17': 'b:bioactives',
  '18': 'b:bioactives',     // trigonelline (mislabeled per CLAUDE.md)
};

// topic_category keyword → branch id. Bibliography rows use rich strings like
// "Diabetes / Systematic Review", "Cardiovascular / Meta-analysis", etc.
//
// Order matters: more-specific branches (mechanism, performance) run BEFORE
// the broad "health" net so a "Pharmacokinetics / CYP1A2" paper goes to
// mechanism and not to a generic health bucket.
function topicToBranch(topic: string | null): string | null {
  if (!topic) return null;
  const t = topic.toLowerCase();

  // Mechanism & pharmacology — molecular / receptor / drug-interaction layer
  if (/(pharmaco|cyp1a2|cyp3a4|adenosine|receptor|gene expression|epigenetic|telomere|circadian|melatonin|endothelial|molecular mechanism|metaboli[sz]m\b|drug interaction|drug-drug)/.test(t)) return 'b:mechanism';

  // Performance & ergogenics
  if (/(performance|ergogenic|athletic|endurance|exercise|sports|doping)/.test(t)) return 'b:performance';

  // Mycotoxins / contaminants / metals — these stay tight
  if (/(ochratoxin|aflatoxin|mycotoxin|fumonisin)/.test(t))        return 'b:mycotoxin';
  if (/(acrylamide|furan|\bpah\b)/.test(t))                        return 'b:contaminant';
  if (/(lead|cadmium|arsenic|mercury|heavy metal)/.test(t))        return 'b:metals';

  // Bioactives — chemistry of the cup
  if (/(chlorogenic|cga|melanoidin|trigonelline|polyphenol|caffeine|diterpene|phytochemical|antioxidant|cafestol|kahweol)/.test(t)) return 'b:bioactives';
  if (/(roast|maillard)/.test(t))                                  return 'b:roast';
  if (/(brew|extract|grind|\bwater\b)/.test(t))                    return 'b:brew';

  // Field & farm
  if (/(soil|microbio|mycorrhiz|rhizo)/.test(t))                   return 'b:soil';
  if (/(agriculture|farming|cultivat|varietal|altitude|shade|terroir)/.test(t)) return 'b:agriculture';
  if (/(sourcing|trade|certif|sustain|climate)/.test(t))           return 'b:sourcing';
  if (/(process|washed|natural|honey|fermentation|drying)/.test(t)) return 'b:process';

  // Culture
  if (/(culture|history|ritual|caf[eé])/.test(t))                  return 'b:culture';

  // Health outcomes — split by body system. Most-specific patterns first so
  // a "Liver Cancer" study lands on oncology (not hepatic), and a "Renal CKD
  // / OTA" study lands on renal (not mycotoxin — that already happened above).
  if (/(cancer|carcinog|tumor|oncolog|leukem|lymphom|hcc|hepatocellular)/.test(t)) return 'b:oncology';
  if (/(parkinson|alzheim|dementia|cognit|depression|mental|migraine|headache|neuro|adhd|sleep apnea)/.test(t)) return 'b:neurological';
  if (/(longevity|all-cause|mortality)/.test(t))                   return 'b:longevity';
  if (/(cardio|cardiovasc|stroke|heart|hypertension|atrial|coronary|endothelial|vascular|cholesterol|lipid|triglyceride)/.test(t)) return 'b:cardiovascular';
  if (/(diabetes|t2d|metabolic|glycem|insulin|obesity|bmi|gout|uric acid)/.test(t)) return 'b:metabolic';
  if (/(thyroid|tsh|cortisol|testosterone|estrogen|hpa|adrenal|pituitary|hormone)/.test(t)) return 'b:metabolic';
  if (/(liver|hepat|nafld|cirrhosis)/.test(t))                     return 'b:hepatic';
  if (/(gut|gi|gastro|intestin|bifido|colorectal|ibs|colitis)/.test(t)) return 'b:hepatic';
  if (/(kidney|renal|ckd|nephr|urinary)/.test(t))                  return 'b:renal';
  if (/(bone|osteoporo|osteo|fracture|skeletal|bmd|joint|muscle|sarcopenia)/.test(t)) return 'b:musculoskeletal';
  if (/(pregnancy|miscarriage|birth weight|fetal|fertility|reproduct|erectile|sexual|prostate|breast)/.test(t)) return 'b:reproductive';
  if (/(immune|inflammation|crp|il-?6|cytokine|t cell|b cell|nk cell|immunolog|allerg|autoimmun)/.test(t)) return 'b:immune';
  if (/(macular|vision|eye|hearing|tinnitus|auditory|skin|dermato|dental|tooth|enamel|wound|collagen|fibroblast|hair)/.test(t)) return 'b:sensory';
  if (/(safety|toxicol|adverse)/.test(t))                          return 'b:longevity';
  if (/(taste|bitter|tas2r)/.test(t))                              return 'b:bioactives';

  return null;
}

function paperToBranch(s: SourceRow): string | null {
  if (s.chapter && CHAPTER_TO_BRANCH[s.chapter]) return CHAPTER_TO_BRANCH[s.chapter];
  return topicToBranch(s.topic_category);
}

export async function GET() {
  const supabase = supabaseServer(await cookies());

  // Auth gate — atlas is editor + user readable, so just need authenticated.
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const [branchesRes, edgesRes, layoutRes, sourcesRes, routesRes] = await Promise.all([
    supabase.from('kb_atlas_branches').select('*').order('display_order'),
    supabase.from('kb_atlas_edges').select('*'),
    supabase.from('kb_atlas_layout').select('*'),
    supabase
      .from('sources')
      .select('id, title, kind, chapter, topic_category, doi')
      .is('valid_until', null)
      .in('kind', ['research_paper', 'coffee_book', 'reva_skill', 'purity_brain']),
    supabase.from('kb_atlas_topic_routes').select('topic_pattern, branch_id'),
  ]);

  if (branchesRes.error) return NextResponse.json({ error: branchesRes.error.message }, { status: 500 });

  const branches = branchesRes.data ?? [];
  const edges = edgesRes.data ?? [];
  const sources = (sourcesRes.data ?? []) as SourceRow[];

  // Editor-curated topic routes — these win over the hardcoded regex.
  // The topic_pattern is stored lowercased; we match on lowercased topic_category.
  const editorRoutes: Record<string, string> = {};
  for (const r of routesRes.data ?? []) editorRoutes[r.topic_pattern.toLowerCase()] = r.branch_id;

  // Defensive: only route papers to branches that actually exist in the DB.
  const branchIds = new Set(branches.map((b) => b.id));

  function routePaper(s: SourceRow): string | null {
    if (s.chapter && CHAPTER_TO_BRANCH[s.chapter]) return CHAPTER_TO_BRANCH[s.chapter];
    if (s.topic_category) {
      const editorMatch = editorRoutes[s.topic_category.toLowerCase()];
      if (editorMatch) return editorMatch;
    }
    return topicToBranch(s.topic_category);
  }

  // Map each source to a branch; skip unmapped.
  const papers: Array<{ id: string; title: string; branchId: string; kind: string; doi: string | null }> = [];
  let unmapped = 0;
  for (const s of sources) {
    const branchId = routePaper(s);
    if (!branchId || !branchIds.has(branchId)) { unmapped++; continue; }
    papers.push({
      id: s.id,
      title: s.title ?? '(untitled)',
      branchId,
      kind: s.kind ?? 'unknown',
      doi: s.doi,
    });
  }

  // Defensive: drop edges that point to nodes we don't know about.
  const cleanEdges = edges.filter((e) =>
    branchIds.has(e.source_node_id) && branchIds.has(e.target_node_id),
  );

  // Layout map: { nodeId → { x, y, locked } }
  const layout: Record<string, { x: number; y: number; locked: boolean }> = {};
  for (const l of layoutRes.data ?? []) {
    layout[l.node_id] = { x: Number(l.x), y: Number(l.y), locked: !!l.locked };
  }

  return NextResponse.json({
    branches,
    papers,
    edges: cleanEdges,
    layout,
    stats: {
      sourcesTotal: sources.length,
      papersMapped: papers.length,
      papersUnmapped: unmapped,
    },
  });
}
