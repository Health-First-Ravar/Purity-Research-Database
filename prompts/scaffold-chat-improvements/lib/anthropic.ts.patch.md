# Patch: `lib/anthropic.ts`

Extend `GenerateResult` with two new fields the model now returns, and
update the parser to read them. Backward-compatible: missing fields default
to `false` / `null`.

```diff
 export type GenerateResult = {
   answer: string;
   confidence_score: number;
   cited_chunk_ids: string[];
   insufficient_evidence: boolean;
+  escalation_recommended: boolean;
+  escalation_reason: string | null;
   reasoning?: string;
 };
```

In `parseGenerateResult`:

```diff
   try {
     const j = JSON.parse(match[0]);
     return {
       answer: String(j.answer ?? ''),
       confidence_score: Number(j.confidence_score ?? 0),
       cited_chunk_ids: Array.isArray(j.cited_chunk_ids) ? j.cited_chunk_ids.map(String) : [],
       insufficient_evidence: Boolean(j.insufficient_evidence ?? false),
+      escalation_recommended: Boolean(j.escalation_recommended ?? false),
+      escalation_reason: j.escalation_reason ? String(j.escalation_reason) : null,
       reasoning: j.reasoning ? String(j.reasoning) : undefined,
     };
   } catch {
     return {
       answer: raw.trim(),
       confidence_score: 0,
       cited_chunk_ids: [],
       insufficient_evidence: true,
+      escalation_recommended: false,
+      escalation_reason: null,
     };
   }
```

And the no-match branch (early return) gets the same two defaults.
