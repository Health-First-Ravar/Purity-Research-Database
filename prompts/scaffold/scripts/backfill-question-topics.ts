// Re-classify all historical messages and write message_topics rows.
// Idempotent: composite primary key (message_id, topic_id) prevents dupes.
//
// Run with:  tsx scripts/backfill-question-topics.ts
// Optional flags via env:
//   BACKFILL_LIMIT=500   only process the most recent N messages
//   BACKFILL_DRY=1       print what would be inserted, don't write

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.ANTHROPIC_MODEL_CLASSIFY ?? 'claude-haiku-4-5-20251001';

type Topic = { id: string; slug: string; label: string; category: string };

async function classify(question: string, topics: Topic[]): Promise<string[]> {
  const dictionary = topics.map((t) => `  - ${t.slug}: ${t.label} (${t.category})`).join('\n');
  const system = `You tag a customer question with zero or more topic slugs from this dictionary:
${dictionary}

Pick only slugs that clearly apply. It is fine to return [] if none fit.
Return JSON only:
{"topic_slugs": ["slug1","slug2"]}`;
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    system,
    messages: [{ role: 'user', content: question }],
  });
  const text = res.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]);
    return Array.isArray(j.topic_slugs) ? j.topic_slugs.map(String) : [];
  } catch { return []; }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE env vars not set');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const limit = Number(process.env.BACKFILL_LIMIT ?? 1000);
  const dry = process.env.BACKFILL_DRY === '1';

  const { data: topicsRows } = await sb.from('question_topics').select('id, slug, label, category');
  const topics = (topicsRows ?? []) as Topic[];
  const slugToId = new Map(topics.map((t) => [t.slug, t.id]));
  console.log(`Loaded ${topics.length} topics`);

  const { data: msgs } = await sb
    .from('messages')
    .select('id, question')
    .order('created_at', { ascending: false })
    .limit(limit);
  console.log(`Processing ${msgs?.length ?? 0} messages (dry=${dry})`);

  let assigned = 0;
  for (const m of msgs ?? []) {
    const slugs = await classify(m.question, topics);
    if (!slugs.length) continue;
    const rows = slugs
      .map((s) => slugToId.get(s))
      .filter((id): id is string => Boolean(id))
      .map((topic_id) => ({
        message_id: m.id,
        topic_id,
        confidence: 0.7,
        source: 'backfill' as const,
      }));
    if (!rows.length) continue;
    assigned += rows.length;
    if (dry) {
      console.log(`would insert ${rows.length} rows for msg ${m.id}: ${slugs.join(',')}`);
    } else {
      const { error } = await sb.from('message_topics').upsert(rows, { onConflict: 'message_id,topic_id' });
      if (error) console.error(`! ${m.id}: ${error.message}`);
    }
  }
  console.log(`\nDone. ${dry ? 'Would have' : ''} assigned ${assigned} (message, topic) pairs.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
