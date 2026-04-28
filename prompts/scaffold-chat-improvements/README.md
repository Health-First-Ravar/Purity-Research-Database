# Chat improvements: Reva-voiced answers + smarter escalation

Three changes to the customer chat surface that fix the "honestly, I don't have
the evidence in front of me" failure mode visible in the screenshot. The
suggested prompt "Is PROTECT good for someone with acid reflux?" should never
escalate — it has a clear, on-brand answer (recommend EASE, here's the
mechanism: NMP from trigonelline degradation in the darker roast).

## Files

```
prompts/scaffold-chat-improvements/
├── README.md
├── lib/rag/generate.ts                  →  REPLACES the live generate.ts
├── lib/anthropic.ts.patch.md            →  add escalation_recommended + escalation_reason to GenerateResult
├── app/api/chat/route.ts.patch.md       →  smarter escalation gate
└── before-after-examples.md             →  the PROTECT/reflux case + 4 more
```

## What changes

1. **System prompt rewritten in Reva's voice.**
   - Leads with the answer, not the hedge
   - Embeds a blend-recommender (PROTECT / FLOW / EASE / CALM) so blend questions
     get a clear recommendation
   - Compound reasoning when the question implicates a compound (NMP for reflux,
     CGAs for antioxidants, caffeine + CYP1A2 for sleep, melanoidins for gut)
   - Health-claim hedging stays intact ("may support", "associated with",
     "research suggests"); never "cures", "prevents", "treats"
   - Honest punt path is preserved but reserved for actual unknowables
     (specific lot/COA values not in evidence; severe medical decisions)

2. **Structured-output schema gains two fields.**
   - `escalation_recommended: boolean` — model decides
   - `escalation_reason: string | null` — model explains
   The route trusts the model rather than treating every low-confidence answer
   as an escalation.

3. **Escalation gate patched.**
   - Lower the confidence floor from 0.55 to 0.30 (real uncertainty, not "I'm
     not 100% sure")
   - Only auto-escalate on `escalation_recommended === true` OR genuine
     batch/COA-specific data gaps
   - `insufficient_evidence` no longer auto-escalates by itself; it just labels
     the turn for editor review

## Order of work

1. Replace `dashboard/app/lib/rag/generate.ts` with the file in this folder
2. Apply the `lib/anthropic.ts` patch (extends `GenerateResult` shape)
3. Apply the `app/api/chat/route.ts` patch (escalation gate)
4. Re-run the suggested prompts in `/chat`. Confirm:
   - "Is PROTECT good for someone with acid reflux?" returns an EASE
     recommendation with NMP mechanism, NOT escalated
   - "Is Swiss Water decaf actually chemical-free?" returns a clear yes with
     the GCE process described, NOT escalated
   - "What's the CGA level in FLOW?" — IS escalated (specific lab value)
5. Lint + build green
