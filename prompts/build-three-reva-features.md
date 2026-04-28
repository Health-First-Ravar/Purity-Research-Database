# Build prompt: three Reva-mind features for the Purity Lab Data dashboard

Paste this whole block into Claude Code (or any coding agent) running inside the
`Purity-Lab-Data/` repo. The agent should read `CLAUDE.md` and `knowledge-base/README.md`
before touching code. Build the features in the order listed. Ship migrations first,
then API routes, then UI, then verify with `npm run lint && npm run build`.

---

## Context the agent must load first

Read these files before writing anything:

- `CLAUDE.md` (root) — codebase guide, schema overview, conventions
- `knowledge-base/README.md` — sources, chunking guidance, metadata tags
- `knowledge-base/reva/SKILL.md` — Reva's three operating modes, evidence hierarchy,
  Compound Reasoning Stack, claim validity framework
- `dashboard/app/supabase/migrations/0001_initial.sql` through `0006_*.sql` —
  current schema; new migrations must be `0007_*.sql` and onward
- `dashboard/app/lib/rag/classify.ts`, `retrieve.ts`, `generate.ts` — pipeline shape
- `dashboard/app/app/chat/page.tsx` and `app/api/chat/route.ts` — chat UX and hot path
- `dashboard/app/app/metrics/page.tsx` — current metrics rendering
- `dashboard/preview.html` — brand color tokens (`--aqua`, `--teal`, `--gold`,
  `--brown`, blend palette); reuse via Tailwind tokens defined in
  `dashboard/app/tailwind.config.ts`

Conventions to honor:
- Next.js 15 App Router, server components by default; client components only for
  interactivity
- All new tables/views get RLS; non-editors see only their own rows, editors see all;
  add policies in the migration that creates the table
- pgvector + Voyage `voyage-3-large` at 1024 dimensions; reuse `embedOne()` from
  `lib/voyage.ts` and HNSW cosine pattern from existing chunks index
- No em dashes in user-facing chat copy (Purity brand rule); fine in code, comments,
  docs, and editor-only UI
- Health-claim language: "may support", "associated with", "research suggests" only;
  flag the user immediately if a draft string violates this
- Prefer one focused migration per feature; do not amend prior migrations
- No `localStorage`/`sessionStorage` in any artifact-style preview, but normal
  Next.js cookies and Supabase Auth are fine

---

## Feature 1 — Bioavailability Gap Detector

**What it is.** A tool that takes a draft sentence or paragraph (a newsletter line,
a product-page claim, a chat answer) and returns a structured audit: which compounds
are named, which layers of the Compound Reasoning Stack are engaged, where the
weakest link is, and what regulatory risk flags fire.

The four layers (from the Reva skill):
1. **Mechanism** — biological pathway, receptor, enzyme
2. **Bioavailability** — does the compound survive digestion / absorption / first-pass
   metabolism in meaningful quantity
3. **Evidence quality** — in vitro vs. animal vs. observational vs. RCT; effect size;
   dose-response
4. **Practical implication** — what can legitimately be claimed / decided

A gap is when a claim names a compound and asserts an effect but does not engage
Layer 2 (or names mechanism without bioavailability evidence at all).

### Schema (`migration 0007_claim_audits.sql`)

```sql
create table public.claim_audits (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references public.profiles(id),
  draft_text          text not null,
  context             text,                    -- 'newsletter','module','chat_answer','product_page','other'
  compounds_detected  text[] not null default '{}',  -- canonical names: 'CGA','melanoidins','trigonelline','OTA','acrylamide','caffeine','NMP','cafestol','kahweol'
  mechanism_engaged   boolean not null default false,
  bioavailability_engaged boolean not null default false,
  evidence_engaged    boolean not null default false,
  practical_engaged   boolean not null default false,
  weakest_link        text,                    -- 'mechanism'|'bioavailability'|'evidence'|'practical'
  regulatory_flags    text[] not null default '{}', -- 'cure_word','prevent_word','treat_word','cures_disease','overstated_effect','single_roast_overclaim'
  evidence_tier       text,                    -- '1' (RCT) ... '7' (in vitro)
  suggested_rewrite   text,                    -- Reva's reconstructed claim
  cited_chunk_ids     uuid[] not null default '{}',
  audit_json          jsonb not null default '{}'::jsonb,  -- full structured output
  model               text not null default 'sonnet',
  cost_usd            numeric(10,6),
  created_at          timestamptz not null default now()
);

create index claim_audits_user_idx on public.claim_audits(user_id, created_at desc);
create index claim_audits_compounds_idx on public.claim_audits using gin(compounds_detected);
create index claim_audits_flags_idx on public.claim_audits using gin(regulatory_flags);

alter table public.claim_audits enable row level security;
create policy claim_audits_self_read on public.claim_audits
  for select using (user_id = auth.uid() or public.is_editor());
create policy claim_audits_self_insert on public.claim_audits
  for insert with check (auth.role() = 'authenticated');
create policy claim_audits_editor_all on public.claim_audits
  for all using (public.is_editor()) with check (public.is_editor());
```

### Backend

`dashboard/app/lib/rag/audit-claim.ts`:
- exports `auditClaim({ draft, context, prior })` returning the structured shape above
- system prompt is the **CHALLENGE-mode** Reva system: lead with the strongest
  opposing reading, identify where evidence runs out, distinguish overclaim from
  underclaim, end with a reconstructed claim that holds
- retrieval pass: embed the draft, pull top 8 chunks from `chunks` filtered to
  `kind in ('research_paper','coffee_book')` (evidence sources only — exclude brand
  voice from the audit grounding to avoid laundering brand claims as evidence)
- model: `MODEL_GENERATE` (Sonnet); `max_tokens: 1500`; structured-JSON return

`dashboard/app/app/api/audit/route.ts`:
- POST `{ draft: string, context?: string }` → returns the audit row + cited chunks
- Auth required; rate limit shares the chat token bucket via `rate-limit.ts`
- Inserts into `claim_audits`

### Frontend

`dashboard/app/app/audit/page.tsx`:
- Two columns: left = textarea for the draft + context dropdown; right = audit result
- Result card shows: detected compounds as chips (use blend-color palette where it
  maps; CGAs = aqua, melanoidins = brown, trigonelline = gold, OTA = blend-protect),
  the four-layer status (filled circle for engaged / hollow for missing), weakest
  link badge, regulatory flags as warn tags, evidence tier (1–7) with a small
  legend tooltip, and the **suggested rewrite** in a copy-able card
- Cited chunks below: title, chapter, similarity, expandable to show 600 chars
- Add a small "history" section: editors see everyone's audits, users see their own
- Empty state: a one-line example draft Jeremy can click to demo

### Acceptance criteria
- Pasting "Our coffee prevents Alzheimer's" returns: `regulatory_flags = ['cure_word','prevent_word']`, `evidence_engaged = false` or weakest link = `evidence`, suggested rewrite uses "associated with reduced risk of"
- Pasting "PROTECT delivers higher CGAs because we roast lighter, which is why it supports liver health" returns: `compounds_detected ⊇ ['CGA']`, `mechanism_engaged = true`, `bioavailability_engaged = false`, weakest link = `bioavailability`, rewrite engages absorption/lactone formation
- Empty draft returns 400 with a polite reason
- Lint + build green; new page renders in dark mode

---

## Feature 2 — Customer-Question Heatmap

**What it is.** A view that maps real customer questions (from `messages`) onto a
canonical taxonomy of health-first coffee topics, then overlays canon coverage so
Jeremy and Ildi can see at a glance: "where are people asking, and where is canon
thinnest?" The cells where demand is high and supply is thin are the next things
to write.

### Schema (`migration 0008_question_heatmap.sql`)

Two pieces: a topics dictionary and an assignment table. Plus a view.

```sql
create table public.question_topics (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,           -- 'cga-bioavailability','ota-roast-degradation','swiss-water-decaf' ...
  label        text not null,
  category     text not null,                  -- 'compound','contaminant','blend','process','health_outcome','operations'
  description  text,
  created_at   timestamptz not null default now()
);

create table public.message_topics (
  message_id   uuid not null references public.messages(id) on delete cascade,
  topic_id     uuid not null references public.question_topics(id) on delete cascade,
  confidence   numeric(3,2) not null,          -- 0..1
  source       text not null default 'auto',   -- 'auto' (Haiku classifier) | 'editor'
  created_at   timestamptz not null default now(),
  primary key (message_id, topic_id)
);

create index message_topics_topic_idx on public.message_topics(topic_id);

alter table public.question_topics enable row level security;
alter table public.message_topics  enable row level security;

create policy qt_read   on public.question_topics for select using (auth.role() = 'authenticated');
create policy qt_editor on public.question_topics for all using (public.is_editor()) with check (public.is_editor());

create policy mt_read_self on public.message_topics
  for select using (
    public.is_editor()
    or exists (select 1 from public.messages m where m.id = message_id and m.user_id = auth.uid())
  );
create policy mt_editor on public.message_topics for all using (public.is_editor()) with check (public.is_editor());

-- The heatmap view: per topic, demand (message count, last 30d) vs. supply
-- (active canon_qa rows tagged with the topic slug), plus thumbs-down rate as
-- a quality signal.
create or replace view public.question_heatmap as
with demand as (
  select
    qt.id,
    qt.slug,
    qt.label,
    qt.category,
    count(mt.message_id) filter (where m.created_at > now() - interval '30 days') as msg_count_30d,
    count(mt.message_id) filter (where m.user_rating = -1)                         as thumbs_down_total,
    count(mt.message_id)                                                            as msg_count_total
  from public.question_topics qt
  left join public.message_topics mt on mt.topic_id = qt.id
  left join public.messages m        on m.id = mt.message_id
  group by qt.id
),
supply as (
  select
    qt.id,
    count(c.id) filter (where c.status = 'active') as canon_count
  from public.question_topics qt
  left join public.canon_qa c on qt.slug = any(c.tags)
  group by qt.id
)
select
  d.id, d.slug, d.label, d.category,
  d.msg_count_30d,
  d.msg_count_total,
  d.thumbs_down_total,
  s.canon_count,
  case when d.msg_count_30d > 0 then round(d.thumbs_down_total::numeric / d.msg_count_total, 3) end as miss_rate,
  case when s.canon_count = 0 and d.msg_count_30d >= 3 then true else false end as canon_gap
from demand d join supply s on s.id = d.id;

grant select on public.question_heatmap to authenticated;
```

### Seed the topic dictionary

In `dashboard/app/scripts/seed-question-topics.ts`, insert ~40 topics. Use the
Reva skill's "Technical Knowledge Base" section + the CHC 9-stage cycle as the
source for slugs. Categories:

- `compound`: cga, cga-lactones, melanoidins, trigonelline, caffeine, nmp,
  cafestol-kahweol
- `contaminant`: ota-mycotoxin, aflatoxin, acrylamide, pesticides, heavy-metals,
  pfas, mold
- `blend`: protect, flow, ease, calm; balance (legacy)
- `process`: light-vs-dark-roast, swiss-water-decaf, anaerobic-fermentation,
  washed-vs-natural, packaging-coca-flush, brew-method-filtered-vs-unfiltered
- `health_outcome`: liver, brain-cognitive, gut-microbiome, metabolic-t2d,
  cardiovascular, longevity, parkinsons, alzheimers, mental-health, performance,
  acid-reflux-digestion, sleep
- `operations`: shipping, subscription, pricing, returns, allergens, bulk-orders,
  certifications-organic-bcorp

### Topic assignment (live, on every chat turn)

Extend `dashboard/app/lib/rag/classify.ts` so each chat turn returns
`{ category, requires_fresh, topic_slugs: string[] }`. Use a Haiku call with the
topic dictionary in the system prompt; allow zero or many topics. In
`app/api/chat/route.ts`, after inserting the message, batch-insert into
`message_topics` with the returned slugs.

Also write a one-shot `dashboard/app/scripts/backfill-question-topics.ts` that
re-classifies all historical messages.

### Frontend

`dashboard/app/app/heatmap/page.tsx` (editor-only):
- Grid of cards, one per topic, grouped by category
- Each cell visually encodes two signals:
  - **demand** — color intensity (light → dark teal) by `msg_count_30d`
  - **supply** — small circle in corner, filled if `canon_count > 0`, hollow ring
    if zero (the visual scream-test for `canon_gap = true`)
- Sort/filter: "biggest gaps", "highest miss-rate", "most asked", filter by
  category
- Click a cell → drawer listing recent messages on that topic with their canon
  hit status, confidence, and rating; "Promote to canon" CTA links straight to
  the editor canon-draft flow
- Header KPIs: total topics covered, gaps count, gap-rate, top-3 priority topics
  (gap = true sorted by `msg_count_30d` desc)

### Acceptance criteria
- After backfill, `/heatmap` shows a populated grid with at least
  the seeded topics
- A topic with `canon_count = 0` and `msg_count_30d >= 3` renders as a
  hollow-ring "gap" card and appears in "biggest gaps"
- Clicking a topic opens a drawer with at least the most recent 10 messages
  on that topic
- Non-editor hitting `/heatmap` gets the same editor-required notice as
  `/metrics`
- Backfill script is idempotent (re-runnable without duplicate inserts —
  use the composite primary key)

---

## Feature 3 — "Ask Reva" operator chat

**What it is.** A second chat surface, separate from the customer-service `/chat`,
intended for Jeremy and Ildi. Same pgvector retrieval, but the system prompt
switches based on a mode toggle (CREATE / ANALYZE / CHALLENGE), retrieval weights
shift accordingly, and answers are not constrained by "answer only from evidence"
the way customer chat is — Reva can synthesize and offer opinions, while still
flagging where it left the evidence behind.

This is the operator's thinking partner. It should feel like talking to Reva, not
to a FAQ bot.

### Schema (`migration 0009_reva_sessions.sql`)

```sql
create table public.reva_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id),
  title        text,
  default_mode text not null default 'analyze' check (default_mode in ('create','analyze','challenge')),
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.reva_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.reva_sessions(id) on delete cascade,
  user_id         uuid references public.profiles(id),
  role            text not null check (role in ('user','assistant')),
  mode            text check (mode in ('create','analyze','challenge')),  -- assistant turns only
  content         text not null,
  retrieved_chunk_ids uuid[] not null default '{}',
  cited_chunk_ids uuid[] not null default '{}',
  flags           jsonb not null default '{}'::jsonb,  -- { left_evidence: bool, regulatory_risk: bool, weakest_link: str }
  tokens_in       int,
  tokens_out      int,
  cost_usd        numeric(10,6),
  latency_ms      int,
  created_at      timestamptz not null default now()
);

create index reva_messages_session_idx on public.reva_messages(session_id, created_at);
create index reva_sessions_user_idx on public.reva_sessions(user_id, updated_at desc);

alter table public.reva_sessions enable row level security;
alter table public.reva_messages enable row level security;

-- Editor-only: this is operator surface, not customer surface
create policy reva_sessions_editor on public.reva_sessions
  for all using (public.is_editor()) with check (public.is_editor());
create policy reva_messages_editor on public.reva_messages
  for all using (public.is_editor()) with check (public.is_editor());
```

### Backend

`dashboard/app/lib/rag/reva.ts`:
- exports `MODE_PROMPTS = { create, analyze, challenge }` — each is a string built
  from the matching section of `knowledge-base/reva/SKILL.md`. Read the file at
  build time (`fs.readFile` in a server module) and slice by the H3 mode headings
  so the prompts stay in sync with the canonical skill
- exports `askReva({ session_id, mode, question, prior, retrieval_weights })`
  where:
  - retrieval pulls top 12 chunks; weights bias source kinds:
    - `create` mode: 0.6 brand+reva, 0.4 evidence
    - `analyze` mode: 0.2 brand, 0.8 evidence
    - `challenge` mode: 0.1 brand, 0.9 evidence
  - implement weighting by running two `match_chunks` calls (one with
    `source_kinds=['purity_brain','reva_skill']`, one with
    `['research_paper','coffee_book']`) and merging at the requested ratio
- structured JSON return: `{ answer, cited_chunk_ids, flags: { left_evidence, regulatory_risk, weakest_link } }`
- model: `MODEL_GENERATE` (Sonnet); `max_tokens: 2000`

`dashboard/app/app/api/reva/route.ts`:
- POST `{ session_id, mode, question }`; reuse `prior` window pattern from
  `app/api/chat/route.ts`
- Editor-only via `is_editor()` check at top; return 403 otherwise

`dashboard/app/app/api/reva/sessions/route.ts`:
- GET → list editor's sessions (most recent first), POST → create new session,
  PATCH `?id=` → rename / pin / change default mode

### Frontend

`dashboard/app/app/reva/page.tsx` and `app/reva/[session]/page.tsx`:
- Sidebar: pinned sessions on top, then recent. "New session" button. Optional
  search.
- Main column: chat thread (similar style to `/chat` but with a darker, more
  "studio" feel — use `--brown` background + cream type, brand-mark in serif);
  three-button mode switcher in the composer with subtle copy:
  - **Create** (gold) — "draft, copy, modules"
  - **Analyze** (aqua) — "what does this mean"
  - **Challenge** (rust/protect) — "pressure-test this"
- Each assistant turn shows: mode tag, cited chunks (collapsible), and any flags
  (e.g., a small banner "Left the evidence — synthesis only" or
  "Regulatory risk: rewrite suggested")
- Slash commands in the input:
  - `/audit <text>` — runs Feature 1 inline
  - `/heatmap <topic>` — fetches the heatmap row for that topic and renders
    demand + canon stats inline
  - `/cite <doi>` — pulls the bibliography row for the DOI
- Reset session button preserves session row but starts a new turn group;
  rename via inline contenteditable on the title

### Acceptance criteria
- Editor signs in, lands at `/reva`, creates a session, sends a question
- Mode toggle visibly changes the assistant's tone and cited-chunk balance
  (verify with two side-by-side runs of the same question across `analyze`
  vs. `challenge`)
- Non-editor request to `/api/reva` returns 403
- `/audit` slash command renders an inline audit card and writes to
  `claim_audits`
- All three modes properly cite chunk IDs that resolve to real `chunks` rows
- Lint + build green

---

## Cross-cutting work

1. **Nav update**: extend `dashboard/app/app/_components/NavLinks.tsx`. New links,
   editor-only where noted: `Audit` (everyone), `Heatmap` (editor),
   `Ask Reva` (editor). Use icons from lucide-react if available; otherwise
   small bullet glyphs.

2. **Brand tokens**: add the missing semantic colors to
   `tailwind.config.ts` if not already present: `purity-aqua-soft`,
   `purity-gold-soft`, `purity-rust-soft` (use the same alpha rules as
   `preview.html`).

3. **No em dashes** in any user-facing string in `/chat`, `/reva` assistant
   messages, or `/audit` rewrites. Editor-only UI strings can use them.

4. **Testing path**: add quick `npm run` scripts:
   - `verify-audit` — runs three fixed prompts against the audit endpoint and
     prints the structured output
   - `verify-heatmap` — counts gap topics and prints the top 5
   - `verify-reva-modes` — runs the same question across all three modes and
     diffs cited-chunk source kinds

5. **Telemetry**: every new endpoint logs to `messages` analog or its own table
   with tokens/cost/latency. Add their costs to the metrics page tiles in a
   follow-up (out of scope for this prompt — note it in the handoff).

---

## Order of work

1. Migration `0007_claim_audits.sql` → `audit-claim.ts` → `/api/audit` →
   `/audit` page → verify
2. Migration `0008_question_heatmap.sql` → seed topics → extend `classify.ts`
   for topic_slugs → backfill script → `/heatmap` page → verify
3. Migration `0009_reva_sessions.sql` → `reva.ts` (mode prompts loaded from
   skill file) → `/api/reva` + sessions routes → `/reva` and `/reva/[session]`
   pages → slash commands → verify
4. Nav links + handoff doc `dashboard/HANDOFF-<today>.md` summarizing what
   shipped, what is deferred, and the new metrics-page extensions queued

## Non-goals (do not do in this pass)

- Do not rebuild `/chat` itself. The customer-service surface keeps its
  existing strict "answer only from evidence" rule.
- Do not retrofit historical `messages` with audit results.
- Do not auto-promote audit suggestions to `canon_qa`. Keep audit results
  isolated to their own table; promotion stays manual via the editor flow.
- Do not change the rate-limit semantics for the customer chat. `/api/reva`
  and `/api/audit` may share the same RPC but should have their own caps if
  needed (default: same 30/min, 500/day).

---

## Style and tone reminders for the agent

- Speak to Jeremy as a peer; precise terminology, no beginner caveats
- Use cautious health-claim language in any user-facing string
- Cite real schema columns and file paths; do not invent helper functions
  that already exist (check `lib/` first)
- Keep PRs small and reviewable; one feature per branch
