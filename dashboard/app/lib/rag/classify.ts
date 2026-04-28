// Haiku classifier: one call, cheap, returns a label + optional blend/batch focus
// PLUS topic_slugs (looked up against the kb_atlas-adjacent question_topics
// dictionary so editors can grow the taxonomy without redeploys).

import { anthropic, MODEL_CLASSIFY } from '../anthropic';
import { supabaseAdmin } from '../supabase';

export type Classification = {
  category: 'coa' | 'blend' | 'health' | 'product' | 'shipping' | 'subscription' | 'other';
  blend: 'PROTECT' | 'FLOW' | 'EASE' | 'CALM' | null;
  batch_ref: string | null;
  requires_fresh: boolean;   // true => skip canon cache, always re-retrieve
  topic_slugs: string[];     // matched against public.question_topics
};

const TOPIC_LIST_CACHE: { fetched_at: number; lines: string } = { fetched_at: 0, lines: '' };

async function topicLines(): Promise<string> {
  const ttl = 5 * 60 * 1000;
  if (Date.now() - TOPIC_LIST_CACHE.fetched_at < ttl && TOPIC_LIST_CACHE.lines) {
    return TOPIC_LIST_CACHE.lines;
  }
  try {
    const sb = supabaseAdmin();
    const { data } = await sb.from('question_topics').select('slug, label, category');
    const lines = (data ?? [])
      .map((t) => `  - ${t.slug}: ${t.label} (${t.category})`)
      .join('\n');
    TOPIC_LIST_CACHE.fetched_at = Date.now();
    TOPIC_LIST_CACHE.lines = lines;
    return lines;
  } catch {
    return '';
  }
}

function buildSystem(topics: string): string {
  return `You are a fast classifier for Purity Coffee customer-service questions.
Return strict JSON with these keys:
  category: one of coa | blend | health | product | shipping | subscription | other
  blend:    one of PROTECT | FLOW | EASE | CALM, or null
  batch_ref: a lot/batch identifier like "B2024-0117" if present in the question, else null
  requires_fresh: true when the question is about a specific COA, batch, or time-sensitive claim;
                  false for stable conceptual / brand / general questions.
  topic_slugs: array of zero or more matching slugs from this dictionary, [] if none clearly fit:
${topics || '  (dictionary not yet seeded — return [])'}
No prose. JSON only.`;
}

export async function classify(question: string): Promise<Classification> {
  const topics = await topicLines();
  const res = await anthropic.messages.create({
    model: MODEL_CLASSIFY,
    max_tokens: 400,
    system: buildSystem(topics),
    messages: [{ role: 'user', content: question }],
  });
  const text = res.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    return { category: 'other', blend: null, batch_ref: null, requires_fresh: false, topic_slugs: [] };
  }
  try {
    const j = JSON.parse(m[0]);
    return {
      category: j.category ?? 'other',
      blend: j.blend ?? null,
      batch_ref: j.batch_ref ?? null,
      requires_fresh: Boolean(j.requires_fresh),
      topic_slugs: Array.isArray(j.topic_slugs) ? j.topic_slugs.map(String) : [],
    };
  } catch {
    return { category: 'other', blend: null, batch_ref: null, requires_fresh: false, topic_slugs: [] };
  }
}
