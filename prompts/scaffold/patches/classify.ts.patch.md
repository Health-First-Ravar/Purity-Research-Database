# Patch: `lib/rag/classify.ts`

Extend the classifier to also return `topic_slugs: string[]`, picked from the
`question_topics` dictionary. The existing `category` and `requires_fresh`
fields stay as they are — this just adds an extra field.

## Diff (semantic — apply by hand)

```diff
 import { anthropic, MODEL_CLASSIFY } from '../anthropic';
+import { supabaseAdmin } from '../supabase';

 export type Classification = {
   category: 'coa' | 'blend' | 'health' | 'product' | 'shipping' | 'subscription' | 'other';
   blend: 'PROTECT' | 'FLOW' | 'EASE' | 'CALM' | null;
   batch_ref: string | null;
   requires_fresh: boolean;
+  topic_slugs: string[];
 };

-const SYSTEM = `You are a fast classifier for Purity Coffee customer-service questions.
-Return strict JSON with these keys:
-  category: one of coa | blend | health | product | shipping | subscription | other
-  blend:    one of PROTECT | FLOW | EASE | CALM, or null
-  batch_ref: a lot/batch identifier like "B2024-0117" if present in the question, else null
-  requires_fresh: true when the question is about a specific COA, batch, or time-sensitive claim;
-                  false for stable conceptual / brand / general questions.
-No prose. JSON only.`;
+const TOPIC_LIST_CACHE: { fetched_at: number; lines: string } = { fetched_at: 0, lines: '' };
+
+async function topicLines(): Promise<string> {
+  const ttl = 5 * 60 * 1000;
+  if (Date.now() - TOPIC_LIST_CACHE.fetched_at < ttl && TOPIC_LIST_CACHE.lines) {
+    return TOPIC_LIST_CACHE.lines;
+  }
+  const sb = supabaseAdmin();
+  const { data } = await sb.from('question_topics').select('slug, label, category');
+  const lines = (data ?? [])
+    .map((t) => `  - ${t.slug}: ${t.label} (${t.category})`)
+    .join('\n');
+  TOPIC_LIST_CACHE.fetched_at = Date.now();
+  TOPIC_LIST_CACHE.lines = lines;
+  return lines;
+}
+
+function buildSystem(topics: string): string {
+  return `You are a fast classifier for Purity Coffee customer-service questions.
+Return strict JSON with these keys:
+  category: one of coa | blend | health | product | shipping | subscription | other
+  blend:    one of PROTECT | FLOW | EASE | CALM, or null
+  batch_ref: a lot/batch identifier like "B2024-0117" if present in the question, else null
+  requires_fresh: true when the question is about a specific COA, batch, or time-sensitive claim;
+                  false for stable conceptual / brand / general questions.
+  topic_slugs: array of zero or more matching slugs from this dictionary, [] if none clearly fit:
+${topics}
+No prose. JSON only.`;
+}

 export async function classify(question: string): Promise<Classification> {
+  const topics = await topicLines();
   const res = await anthropic.messages.create({
     model: MODEL_CLASSIFY,
-    max_tokens: 200,
-    system: SYSTEM,
+    max_tokens: 400,
+    system: buildSystem(topics),
     messages: [{ role: 'user', content: question }],
   });
   const text = res.content
     .filter((c) => c.type === 'text')
     .map((c) => (c as { text: string }).text)
     .join('\n');
   const m = text.match(/\{[\s\S]*\}/);
   if (!m) {
-    return { category: 'other', blend: null, batch_ref: null, requires_fresh: false };
+    return { category: 'other', blend: null, batch_ref: null, requires_fresh: false, topic_slugs: [] };
   }
   try {
     const j = JSON.parse(m[0]);
     return {
       category: j.category ?? 'other',
       blend: j.blend ?? null,
       batch_ref: j.batch_ref ?? null,
       requires_fresh: Boolean(j.requires_fresh),
+      topic_slugs: Array.isArray(j.topic_slugs) ? j.topic_slugs.map(String) : [],
     };
   } catch {
-    return { category: 'other', blend: null, batch_ref: null, requires_fresh: false };
+    return { category: 'other', blend: null, batch_ref: null, requires_fresh: false, topic_slugs: [] };
   }
 }
```

## Why
- Topic dictionary lives in the DB so editors can add / rename topics without
  a redeploy.
- 5-minute in-process cache keeps Haiku prompts cheap.
- Default to `[]` on parse fail so the chat path keeps working.
