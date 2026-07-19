// Recompute canon_qa.question_embed for every row.
//
//   npx tsx --env-file=.env.local scripts/embed-canon.ts          # dry run
//   npx tsx --env-file=.env.local scripts/embed-canon.ts --apply
//
// package.json has referenced `npm run embed-canon` since the first migration,
// but the script itself was never written — so the documented way to repair
// canon embeddings did not exist. Written in session 12, when it was needed.
//
// WHY IT IS NEEDED NOW
//
// Canon questions were embedded with voyage input_type 'document' while
// findCanonHit() queries with 'query'. Voyage's document and query embeddings
// are asymmetric — intended for short-query-against-long-passage retrieval.
// Canon matching is question-against-question, which is symmetric, so the
// mismatch cost most of the signal. Measured against the live index:
//
//                        stored 'document'   stored 'query'
//   identical question        0.6955            0.9999
//   near paraphrase           0.6362            0.8815
//   casual paraphrase         0.6122            0.8195
//   unrelated (control)       0.2976            0.3041
//
// match_canon's floor is 0.80, so under the old scheme even an exact repeat of
// a canon question scored 0.6955 and the cache could never fire — for any
// input, ever. That, not just the absence of active rows, is why every
// canon_qa row has hit_count = 0.
//
// The write sites now use 'query'. This script re-embeds rows written before
// that change.

import { createClient } from '@supabase/supabase-js';
import { embed } from '../lib/voyage';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL/service-role key required');

const APPLY = process.argv.includes('--apply');
const BATCH = 32;

const sb = createClient(URL, KEY);

async function main() {
  const { data: rows, error } = await sb
    .from('canon_qa')
    .select('id, question, status')
    .order('created_at', { ascending: true });
  if (error) throw error;

  console.log(`canon_qa rows: ${rows.length}`);
  const byStatus = rows.reduce<Record<string, number>>((a, r) => {
    a[r.status] = (a[r.status] ?? 0) + 1;
    return a;
  }, {});
  console.log('  by status:', byStatus);

  if (!APPLY) {
    console.log(`\nDRY RUN — would re-embed ${rows.length} question(s) with input_type 'query'.`);
    console.log('Re-run with --apply.');
      return;
  }

  let done = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // 'query' — symmetric with findCanonHit(). See the header note.
    const vecs = await embed(batch.map((r) => r.question), 'query');
    for (let j = 0; j < batch.length; j++) {
      const { error: upErr } = await sb
        .from('canon_qa')
        .update({ question_embed: vecs[j] as unknown as string })
        .eq('id', batch[j].id);
      if (upErr) {
        console.error(`  FAILED ${batch[j].id}: ${upErr.message}`);
        failed++;
      } else {
        done++;
      }
    }
    console.log(`  ${done}/${rows.length}`);
  }

  console.log(`\ndone. re-embedded=${done} failed=${failed}`);
  console.log('Canon rows at status=active can now actually be served by match_canon.');
}

main().catch((e) => { console.error(e); process.exit(1); });
