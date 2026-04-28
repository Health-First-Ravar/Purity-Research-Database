# Reva Helper — floating Clippy-style assistant (desktop only)

A small floating widget pinned to the lower-left corner of the dashboard.
Reva-voiced, Haiku-powered, no retrieval. Two jobs:

1. **Answer general coffee knowledge** briefly and in Reva's voice.
2. **Point the user to the right tab** in the app when the question would be
   better answered there (Reports, Bibliography, Heatmap, etc.). The tab
   suggestion renders as a clickable button, not just a sentence.

## Why this is small

- **Haiku**, not Sonnet — this is short helper text, not deep research. Costs
  pennies per thousand turns.
- **No retrieval** — embedded persona + condensed knowledge base + tab
  dictionary in the system prompt is enough. Saves the embedding call and
  the DB hit.
- **Structured output** — `{ answer, suggested_tab: { href, label, why } | null }` —
  the UI renders the optional tab suggestion as a button.
- **Desktop only** — hidden via CSS at < 1024px viewport. Phones already have
  the full nav and don't need a hover companion.
- **Role-aware** — non-editors won't be suggested editor-only tabs (`/heatmap`,
  `/reva`, `/editor*`, `/metrics`).

## Files

```
prompts/scaffold-reva-helper/
├── README.md
├── lib/rag/reva-helper.ts                     (Haiku call + tab dictionary)
├── app/api/reva-helper/route.ts               (auth + role-aware POST)
├── app/_components/RevaClippy.tsx             (the floating widget)
└── patches/
    └── layout.tsx.patch.md                    (mount the widget in root layout)
```

## Behavior

- Closed: a 48px circular brand-mark button (italic serif "R" on teal),
  pinned bottom-left with a soft shadow.
- Open: 360px wide, 520px tall panel. Header with avatar + "Ask Reva" + close
  button. Chat thread below. Composer with hint copy at bottom.
- Toggle keyboard shortcut: **⌘ /** (Mac) or **Ctrl /** (Windows). ESC closes.
- First-visit greeting is a haiku (the model is Haiku — the form is haiku —
  the pun is the welcome). After dismissal, doesn't auto-pop again.
- Suggestion button: when the model returns a `suggested_tab`, renders a
  small chip below the answer like `→ Reports` that navigates on click.
- **`/haiku <question>` slash command** — answers the question in a single
  5-7-5 haiku. Tab suggestion still works. Easter egg, intentional.

## Tighter punt-to-/chat behavior

The system prompt was rewritten to push harder on routing than on answering.
Anything that would need more than four sentences, or anything with hedged
health-claim language, gets one sentence of orientation plus a `→ Research Hub`
suggestion. The helper is a navigator and a quick-fact lookup, not a deep
responder. /chat is built for paragraphs; the helper isn't.

Examples of how it routes now:

| User asks | Helper does |
|---|---|
| "What does CGA stand for?" | Answers in one line. No tab. |
| "Where's the COA report for FLOW lot B2024-0117?" | One-line orientation + `→ Reports` |
| "Is PROTECT good for someone with reflux?" | One-sentence headline + `→ Research Hub` |
| "Does coffee help with Alzheimer's?" | One-sentence framing + `→ Research Hub` |
| "Search the literature on melanoidins" | One-line acknowledgment + `→ Bibliography` |
| "/haiku what is FLOW" | Three-line haiku about FLOW. |

## Cost expectation

Haiku 4.5 priced ~$1/M input, $5/M output. Average helper turn ~600 input
tokens (system prompt + tab dictionary + question), ~150 output tokens.
≈ $0.0015 per turn. At 1000 helper interactions per month, ~$1.50/mo.

## Optional future extensions (not in this scaffold)

- Slash commands inside the helper (`/canon foo` → search canon for "foo")
- Mini analytics: which tab suggestions get clicked, which don't (needs a
  small `helper_events` table)
- Voice mode (web speech API) for accessibility
- Sticky "did this help?" thumbs after each turn
