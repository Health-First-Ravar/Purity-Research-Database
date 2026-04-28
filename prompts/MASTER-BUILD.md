# Master Build Manifest — Purity Lab Data

**One document. Hand this to Claude Code (or any coding agent) running inside
the `Purity-Lab-Data/` repo and it has everything needed to ship every feature
that has been scaffolded into `prompts/scaffold-*/` over the last sessions.**

---

## What this build delivers

Six features, in dependency order:

1. **Chat Improvements** — Reva-voiced system prompt + smarter escalation gate so `/chat` stops over-escalating and starts giving the kind of EASE-for-reflux answer the new prompt produces.
2. **Bioavailability Gap Detector** — `/audit` tool that takes a draft sentence and returns a structured Compound Reasoning Stack audit with regulatory flags and a reconstructed claim.
3. **Customer-Question Heatmap** — `/heatmap` editor view showing demand vs. canon coverage per topic, so Jeremy and Ildi see where to write canon next.
4. **Ask Reva (operator mode)** — `/reva` editor chat with three-mode toggle (Create / Analyze / Challenge), separate from `/chat`.
5. **Analyte Limits in Reports** — typed limits module + side panel + chart reference lines on `/reports`. CHC Health-Grade Green Standard sets the strictest numbers.
6. **Metrics Redesign** — `/metrics` rewritten in plain English with status dots + activity chart + collapsible engineering details.
7. **Reva Helper widget (Clippy)** — desktop-only floating helper in lower-left corner, Haiku-powered, routes to the right tab. `/haiku` slash command answers in 5-7-5.

Plus two artifacts that don't change code:

- **`prompts/artifacts/Canon-Bulk-Add-Drafts.docx`** — 50 customer-voiced canon Q&A drafts ready for editor review and bulk insert into `canon_qa`.
- **`prompts/artifacts/CHC-Strictest-Analyte-Limits.xlsx`** — reference spreadsheet of the strictest published limit per analyte.

---

## Conventions the agent must honor

Read these files before writing code:

- `CLAUDE.md` (root) — codebase guide, schema overview, conventions
- `knowledge-base/README.md` — sources, chunking guidance, metadata tags
- `knowledge-base/reva/SKILL.md` — Reva's three operating modes, evidence hierarchy, Compound Reasoning Stack, claim validity framework

Conventions:
- Next.js 15 App Router, server components default, client where needed
- Supabase RLS: editor sees all, user sees own; non-editor 403 on operator surfaces
- pgvector + Voyage `voyage-3-large` (1024d); HNSW cosine indexes
- Tailwind tokens from `dashboard/app/tailwind.config.ts`: `purity-bean`, `purity-cream`, `purity-aqua`, `purity-green`, `purity-paper`, `purity-mist`, `purity-shade`, `purity-ink`, `purity-rust`, `purity-muted`
- Health-claim language: "may support", "associated with", "research suggests" — never "cures", "prevents", "treats"
- **No em dashes in user-facing customer-chat copy** (Purity brand rule). Editor-only UI, code, comments, and docs are fine.
- One focused migration per feature; do not amend prior migrations
- Don't expose `SUPABASE_SERVICE_ROLE_KEY` to the client bundle. Server routes only.

---

## File-destination map

Every scaffold maps directly into `dashboard/app/`. The folder structure inside each scaffold mirrors the destination tree.

| Scaffold | Destination |
|---|---|
| `prompts/scaffold/supabase/migrations/0007_claim_audits.sql` | `dashboard/app/supabase/migrations/0007_claim_audits.sql` |
| `prompts/scaffold/supabase/migrations/0008_question_heatmap.sql` | `dashboard/app/supabase/migrations/0008_question_heatmap.sql` |
| `prompts/scaffold/supabase/migrations/0009_reva_sessions.sql` | `dashboard/app/supabase/migrations/0009_reva_sessions.sql` |
| `prompts/scaffold/lib/rag/audit-claim.ts` | `dashboard/app/lib/rag/audit-claim.ts` |
| `prompts/scaffold/lib/rag/reva.ts` | `dashboard/app/lib/rag/reva.ts` |
| `prompts/scaffold/app/api/audit/route.ts` | `dashboard/app/app/api/audit/route.ts` |
| `prompts/scaffold/app/api/reva/route.ts` | `dashboard/app/app/api/reva/route.ts` |
| `prompts/scaffold/app/api/reva/sessions/route.ts` | `dashboard/app/app/api/reva/sessions/route.ts` |
| `prompts/scaffold/app/api/heatmap/topic-messages/route.ts` | `dashboard/app/app/api/heatmap/topic-messages/route.ts` |
| `prompts/scaffold/app/audit/...` | `dashboard/app/app/audit/...` |
| `prompts/scaffold/app/heatmap/...` | `dashboard/app/app/heatmap/...` |
| `prompts/scaffold/app/reva/...` | `dashboard/app/app/reva/...` |
| `prompts/scaffold/scripts/seed-question-topics.ts` | `dashboard/app/scripts/seed-question-topics.ts` |
| `prompts/scaffold/scripts/backfill-question-topics.ts` | `dashboard/app/scripts/backfill-question-topics.ts` |
| `prompts/scaffold-chat-improvements/lib/rag/generate.ts` | `dashboard/app/lib/rag/generate.ts` (REPLACE) |
| `prompts/scaffold-metrics-redesign/app/metrics/...` | `dashboard/app/app/metrics/...` (REPLACE page.tsx + add new components) |
| `prompts/scaffold-analyte-limits/lib/analytes/limits.ts` | `dashboard/app/lib/analytes/limits.ts` (NEW dir) |
| `prompts/scaffold-analyte-limits/app/reports/_components/AnalyteLimitsPanel.tsx` | `dashboard/app/app/reports/_components/AnalyteLimitsPanel.tsx` |
| `prompts/scaffold-reva-helper/lib/rag/reva-helper.ts` | `dashboard/app/lib/rag/reva-helper.ts` |
| `prompts/scaffold-reva-helper/app/api/reva-helper/route.ts` | `dashboard/app/app/api/reva-helper/route.ts` |
| `prompts/scaffold-reva-helper/app/_components/RevaClippy.tsx` | `dashboard/app/app/_components/RevaClippy.tsx` |

Patches (apply by hand to existing files):

| Patch note | Target file |
|---|---|
| `prompts/scaffold/patches/classify.ts.patch.md` | `dashboard/app/lib/rag/classify.ts` |
| `prompts/scaffold/patches/chat-route.ts.patch.md` | `dashboard/app/app/api/chat/route.ts` |
| `prompts/scaffold/patches/NavLinks.tsx.patch.md` | `dashboard/app/app/_components/NavLinks.tsx` |
| `prompts/scaffold/patches/package.json.patch.md` | `dashboard/app/package.json` |
| `prompts/scaffold-chat-improvements/lib/anthropic.ts.patch.md` | `dashboard/app/lib/anthropic.ts` |
| `prompts/scaffold-chat-improvements/app/api/chat/route.ts.patch.md` | `dashboard/app/app/api/chat/route.ts` |
| `prompts/scaffold-analyte-limits/patches/reports-page.tsx.patch.md` | `dashboard/app/app/reports/page.tsx` |
| `prompts/scaffold-analyte-limits/patches/AnalyteChart.tsx.patch.md` | `dashboard/app/app/reports/_components/AnalyteChart.tsx` |
| `prompts/scaffold-reva-helper/patches/layout.tsx.patch.md` | `dashboard/app/app/layout.tsx` |

---

## Build order

Strict dependency order. Each phase ends with `npm run lint && npm run build` green before moving on.

### Phase 0 — Pre-flight

```
cd dashboard/app
npm install
npm run lint && npm run build           # baseline green
```

### Phase 1 — Migrations

Apply in numeric order via Supabase CLI. Migrations are additive; safe to ship before code.

```
supabase db push
```

Verifies that all of these tables/views exist after:
- `claim_audits` (table)
- `question_topics`, `message_topics` (tables)
- `question_heatmap` (view)
- `reva_sessions`, `reva_messages` (tables)

### Phase 2 — Foundation modules (no live-route dependencies)

Copy in:
- `lib/analytes/limits.ts`
- `lib/rag/audit-claim.ts`
- `lib/rag/reva.ts`
- `lib/rag/reva-helper.ts`

Apply patch:
- `lib/anthropic.ts` — add `escalation_recommended` + `escalation_reason` to `GenerateResult`

### Phase 3 — Chat pipeline rewrite (touches the live `/chat`)

REPLACE:
- `lib/rag/generate.ts` (Reva-voiced system prompt, lead-with-the-answer, blend-recommender embedded, hedged health language, no em dashes)

Apply patches:
- `lib/rag/classify.ts` — extend `Classification` with `topic_slugs: string[]`
- `app/api/chat/route.ts` — TWO patches to apply together:
  - the escalation gate rewrite (from `scaffold-chat-improvements/`)
  - the `message_topics` write after insert (from `scaffold/`)

Run:
```
npm run lint && npm run build
```

Manual smoke test of the four cases in `prompts/scaffold-chat-improvements/before-after-examples.md`:
- "Is PROTECT good for someone with acid reflux?" → EASE recommendation, NOT escalated
- "Is Swiss Water decaf actually chemical-free?" → confident yes, NOT escalated
- "What's the CGA level in FLOW lot B2024-0117?" → orientation + escalated with reason `specific_data_missing`
- "I'm pregnant — can I drink Purity?" → orientation + escalated with reason `pregnancy_personalization`

### Phase 4 — New API routes (no UI yet)

Copy in:
- `app/api/audit/route.ts`
- `app/api/reva/route.ts`
- `app/api/reva/sessions/route.ts`
- `app/api/heatmap/topic-messages/route.ts`
- `app/api/reva-helper/route.ts`

Build green. Each route can be smoke-tested with `curl` before any UI lands.

### Phase 5 — UI pages

Copy in entire scaffolded folders:
- `app/audit/...` (page + AuditForm + AuditResult)
- `app/heatmap/...` (page + TopicCell + TopicDrawer)
- `app/reva/...` (page + [session]/page + RevaChat + ModeSwitcher + SessionSidebar)
- `app/reports/_components/AnalyteLimitsPanel.tsx`

REPLACE:
- `app/metrics/page.tsx` (and add the three new components: ActivityChart, Explainer, EngineeringDetails)

Apply patches:
- `app/reports/page.tsx` — slot the `AnalyteLimitsPanel` next to the chart in a 2/3 + 1/3 grid
- `app/reports/_components/AnalyteChart.tsx` — add the optional `ReferenceLine` driven by `getAnalyteLimit().chartThreshold`

Run lint + build.

### Phase 6 — Cross-cutting UI

Copy in:
- `app/_components/RevaClippy.tsx`

Apply patches:
- `app/_components/NavLinks.tsx` — add three new entries: `Audit`, `Heatmap`, `Ask Reva`
- `app/layout.tsx` — mount `<RevaClippy />` once at the root

### Phase 7 — Scripts + seed data

Copy in:
- `scripts/seed-question-topics.ts`
- `scripts/backfill-question-topics.ts`

Apply patch:
- `package.json` — add four npm scripts:
  ```json
  "seed-question-topics":     "tsx scripts/seed-question-topics.ts",
  "backfill-question-topics": "tsx scripts/backfill-question-topics.ts",
  "verify-audit":             "tsx scripts/verify-audit.ts",
  "verify-reva-modes":        "tsx scripts/verify-reva-modes.ts"
  ```

Run:
```
npm run seed-question-topics       # one-shot, idempotent
npm run backfill-question-topics   # processes historical messages
npm run lint && npm run build
```

### Phase 8 — Verification pass

Run these checks. All should pass before declaring shipped:

| Surface | Test |
|---|---|
| `/chat` | Run the four prompts above; confirm escalation behavior matches the rubric |
| `/audit` | Paste "Our coffee prevents Alzheimer's" — returns `regulatory_flags ⊇ ['cure_word','prevent_word']`, weakest link `evidence`, suggested rewrite uses "associated with reduced risk of" |
| `/audit` | Paste "PROTECT delivers higher CGAs because we roast lighter, supporting liver health" — returns `compounds_detected ⊇ ['CGA']`, `bioavailability_engaged: false`, weakest link `bioavailability` |
| `/heatmap` | Editor-only; populated grid; gap topics rendered with hollow-ring corner indicator |
| `/reva` (editor) | Create session, send same question across all three modes; cited-chunk source kinds shift (Create heavier on `purity_brain`/`reva_skill`, Challenge heavier on `research_paper`/`coffee_book`) |
| `/reva` (non-editor) | 403 |
| `/reports` | Pick OTA as analyte — chart renders rust-red dashed reference line at 3.0 ppb (EU 2023/915) and side panel shows the limits table + Purity stance |
| `/metrics` | Three primary tiles with status dots; activity chart renders stacked bars; "What these numbers mean" expands |
| Reva Helper | Click bottom-left brand-mark or hit ⌘/; haiku greeting renders; type "where do I find COA reports?" and confirm `→ Reports` button appears; type `/haiku what is FLOW` and confirm 3-line poetic reply |
| Reva Helper (mobile) | Hidden on viewports < 1024px |

### Phase 9 (optional) — Canon bulk add

Open `prompts/artifacts/Canon-Bulk-Add-Drafts.docx`. Each entry maps directly to a `canon_qa` row. Recommended workflow:
1. Editor reviews each draft for accuracy and voice
2. Bulk insert with `status='draft'` (the document explicitly marks them this way)
3. Second-pass review by Ildi or Jeremy flips `status='active'`

The 50 entries cover blend recommendations, blend descriptions, compound education, contaminant FAQs, process/decaf, eight major health outcomes, and brewing/storage. Tags align with the `question_topics` slugs from Phase 1, so the heatmap will register coverage immediately.

---

## Acceptance criteria — feature by feature

### Chat Improvements
- Suggested prompt "Is PROTECT good for someone with acid reflux?" produces an EASE recommendation with NMP mechanism, confidence ≥ 0.70, NOT escalated
- Lot/COA-specific questions (containing batch numbers like `B2024-0117`) escalate with reason `specific_data_missing`
- Pregnancy / serious medical questions escalate with reason matching `*_personalization`
- No em dashes in any answer body returned by the API

### Bioavailability Gap Detector
- Endpoint persists every audit to `claim_audits`
- UI shows the four-layer Compound Reasoning Stack with engaged/not-engaged dots and a "weakest link" badge
- Suggested rewrite uses hedged health-claim language
- Editors see all audits in the recent list; users see only their own

### Customer-Question Heatmap
- After backfill, `question_heatmap` view returns at least the 46 seeded topics with non-zero rows
- Gap topics (`canon_count = 0` AND `msg_count_30d ≥ 3`) render as hollow-ring cards
- Drawer opens with the most recent 10 messages tagged to that topic
- Non-editor at `/heatmap` sees editor-required notice

### Ask Reva (operator)
- Editor lands at `/reva`, auto-redirects to most recent session if any
- Mode switcher visibly changes assistant tone and cited-chunk balance
- `/audit <text>` slash command renders inline audit card AND writes to `claim_audits`
- Non-editor `POST /api/reva` → 403

### Analyte Limits in Reports
- Selecting OTA shows EU 2023/915 reference at 3.0 ppb on chart and full table in side panel
- Selecting CGAs (bioactive) shows typical-range table instead of regulatory limits, no reference line
- Picking a `raw:lead_mg_kg` analyte from raw_values resolves to the heavy_metal entry; reference line at 0.10 mg/kg
- Side panel shows "Purity stance" block with NOT_DISCLOSED message for analytes Purity hasn't published thresholds for

### Metrics Redesign
- One-line serif summary at the top of the page describes current state in plain English
- Three primary tiles each carry a status dot (green/amber/red/neutral)
- Activity chart renders a stacked bar per day (green = answered in chat, amber = sent to a person)
- "What these numbers mean" and "Engineering details" both collapsible
- Old daily-breakdown table preserved verbatim inside Engineering Details

### Reva Helper widget
- Pinned bottom-left, 48px brand-mark "R", visible only at viewport ≥ 1024px
- ⌘/ (or Ctrl/) toggles open and closed; ESC closes
- First-open greeting is a 5-7-5 haiku
- `/haiku <question>` triggers a poetic 3-line answer
- Tab suggestions render as click-through chips and navigate via `router.push()`
- Editor-only tabs (`/reva`, `/heatmap`, `/editor*`, `/metrics`) never appear as suggestions for non-editors
- Helper never suggests the tab the user is currently on

---

## Cost expectations after this build

Rough per-month at moderate traffic (assume 1000 chat turns, 500 helper turns, 100 audits, 200 operator turns):

| Surface | Model | Per turn | Per month |
|---|---|---|---|
| `/chat` | Sonnet | ~$0.05 | ~$50 |
| Reva Helper | Haiku | ~$0.0015 | ~$0.75 |
| `/audit` | Sonnet | ~$0.04 | ~$4 |
| `/reva` (operator) | Sonnet | ~$0.06 | ~$12 |
| `classify` (per chat turn) | Haiku | ~$0.0008 | ~$0.80 |

Total roughly $70/month at this volume. Voyage embeddings add a few cents.

---

## Rollback plan

Everything except the chat-improvements rewrite is purely additive (new tables, new files, new routes, new pages). To roll back:

- Migrations 0007/0008/0009: leave in place; tables are empty if features aren't used.
- New API routes / new pages: just remove. Nothing depends on them.
- Reva Helper: remove the `<RevaClippy />` mount in `layout.tsx`. The endpoint can stay dormant.
- Metrics page: keep a copy of the original `app/metrics/page.tsx` before replace; restore if needed.
- **Chat improvements (the risky one):** keep a copy of the original `lib/rag/generate.ts` and the original escalation block in `app/api/chat/route.ts`. The new behavior changes what answers customers see; if anything looks wrong, revert these two files specifically without touching the rest.

A `BACKUP/` folder with the pre-replace versions of `generate.ts` and `metrics/page.tsx` is the smallest insurance policy against this.

---

## Where to find each scaffold

- `prompts/scaffold/` — three Reva-mind features (audit, heatmap, ask Reva)
- `prompts/scaffold-chat-improvements/` — generate.ts rewrite + escalation gate
- `prompts/scaffold-metrics-redesign/` — metrics page rebuild
- `prompts/scaffold-analyte-limits/` — limits.ts + AnalyteLimitsPanel + chart reference lines
- `prompts/scaffold-reva-helper/` — Clippy-style floating widget
- `prompts/build-three-reva-features.md` — original verbose build prompt for the first three features (also useful as backup reference)

Each scaffold folder has its own `README.md` with the per-feature detail. This master manifest is the entry point; the scaffolds are the source of truth.

---

## Final note for the implementing agent

Trust the scaffolds — they were written against the actual existing schema, the actual existing patterns (server components, Supabase Auth + RLS, Voyage embeddings, recharts), and the actual brand tokens already in `tailwind.config.ts`. Don't re-derive any of it.

When you encounter a scaffold file:
1. Read the live file at the destination if it exists (so you can preserve any conventions you find there)
2. Read the scaffold file
3. Copy or apply the patch as instructed
4. Run lint + build before moving on

The verification table in Phase 8 is the contract. If all those pass, the build is shipped.
