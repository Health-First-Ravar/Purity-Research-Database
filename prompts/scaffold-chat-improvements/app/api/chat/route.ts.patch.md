# Patch: `app/api/chat/route.ts` — escalation gate

Replace the current "escalate if confidence < 0.55 OR insufficient_evidence"
gate with the smarter rubric below. The model now tells us when it actually
wants to escalate (`escalation_recommended`); we trust that signal and only
fall back to a confidence floor for hard failures.

## Constants

Near the top of the file, replace any existing `CONFIDENCE_FLOOR = 0.55` with:

```ts
// Floor below which we treat the answer as a real failure regardless of what
// the model says. Above this, trust the model's escalation_recommended signal.
const HARD_CONFIDENCE_FLOOR = 0.30;
```

## Escalation decision

Where the route currently sets `escalated` and `escalation_reason`, replace
the logic with:

```ts
// Decide whether to escalate.
// Trust the model's structured signal first; fall back to floors for failures.
let escalated = false;
let escalation_reason: string | null = null;

if (generated.confidence_score < HARD_CONFIDENCE_FLOOR) {
  escalated = true;
  escalation_reason = 'low_confidence';
} else if (generated.escalation_recommended) {
  escalated = true;
  escalation_reason = generated.escalation_reason ?? 'model_flagged';
} else if (
  generated.insufficient_evidence
  && (classification.category === 'coa' || classification.requires_fresh)
) {
  // insufficient_evidence only escalates when the question is batch/COA/
  // time-sensitive — those genuinely need an editor or a fresh pull.
  escalated = true;
  escalation_reason = 'specific_data_missing';
}
```

## What this changes for the user

- "Is PROTECT good for someone with acid reflux?" — model returns a confident
  EASE recommendation with NMP mechanism. `escalation_recommended = false`,
  confidence ~0.85, NOT escalated.
- "What's the CGA level in FLOW lot B2024-0117?" — classification.category
  becomes `coa` and `requires_fresh = true`; if no COA chunk in retrieval,
  escalates with reason `specific_data_missing`.
- "I'm on warfarin and have liver disease — should I drink coffee?" — model
  sets `escalation_recommended = true`, reason `serious_medical_personalization`.
  Escalates so Ildi/Jeremy can respond personally.

## Optional: surface the reason in the UI

In `app/chat/page.tsx`, where the escalation badge is shown today
(`escalated to Ildi / Jeremy`), append the reason in small type when
present. Helps editors triage faster.
