# Purity Lab Data — Codebase Guide

Orientation for Claude (and future humans) working in this repo. Read this first.

## What this is

Three things in one tree:

1. **`knowledge-base/`** — curated substrate for retrieval. Four sources, kept separate on purpose. `reva/` (skill definition), `purity-brain/` (brand/Org DNA from Coda), `coffee-book/` (Ildi's book), `research/` (34 primary-literature papers), `bibliography/` (448-article xlsx catalog). See `knowledge-base/README.md` for the full map.
2. **`dashboard/app/`** — Next.js 15 + Supabase dashboard. Customer-service chat, research hub, COA reports, bibliography browser, editor review queue, metrics page. pgvector handles retrieval in the same Postgres.
3. **`dashboard/preview.html`** — static HTML mock of the dashboard with Purity brand colors applied. Not wired to the DB; for design review.

## Architecture in one paragraph

User asks a question in `/chat` → `/api/chat/route.ts` classifies intent, checks the `canon_qa` cache (pgvector cosine lookup), falls through to retrieve chunks from `chunks` (pgvector) and generate an answer with Anthropic Sonnet, then logs the turn to `messages`. Low confidence or insufficient evidence flips `escalated=true` and the turn shows up in `/editor`. Editors label good/bad or promote to canon, which writes a new `canon_qa` row at `status='draft'` for a review pass. Metrics page reads the `daily_chat_metrics` view. Every tab on the app is RLS-protected: regular users see only their own messages; editors see everything.

## Layout

```
Purity-Lab-Data/
├── CLAUDE.md                         # this file
├── knowledge-base/                   # retrieval substrate (see README there)
├── dashboard/
│   ├── HANDOFF-*.md                  # end-of-session handoff notes
│   ├── preview.html                  # static brand-aligned design mock
│   └── app/                          # the Next.js + Supabase app
│       ├── app/                      # Next App Router routes
│       │   ├── chat/                 # Research Hub — the main chat UI
│       │   ├── reports/              # COA reports (filter by blend/date)
│       │   ├── bibliography/         # 448-row catalog + semantic search
│       │   ├── editor/               # escalation queue + label/promote
│       │   ├── metrics/              # editor-only rollups (daily_chat_metrics)
│       │   └── api/                  # route handlers (chat, feedback, label, metrics, update)
│       ├── lib/
│       │   ├── rag/                  # classify / retrieve / generate
│       │   ├── anthropic.ts          # Sonnet client
│       │   ├── voyage.ts             # embeddings (voyage-3-large, 1024d)
│       │   ├── supabase.ts           # server + admin clients
│       │   └── rate-limit.ts         # per-user token bucket
│       ├── scripts/                  # one-shot data pipelines (tsx runner)
│       │   ├── ingest-kb.ts
│       │   ├── embed-canon.ts
│       │   ├── import-bibliography.ts
│       │   ├── import-coas.ts
│       │   ├── dedupe-research.ts
│       │   └── verify-rls.ts
│       └── supabase/
│           ├── migrations/           # 0001 → 000N, applied in order
│           └── RLS.md                # access matrix
```

## The database

Postgres 15 + pgvector + Supabase Auth + RLS. Migrations in `dashboard/app/supabase/migrations/` — apply in order with `supabase db push`. Key tables:

- **`profiles`** — mirrors `auth.users`. `role ∈ {user, editor}`. `is_editor()` helper reads this.
- **`sources`** — provenance. `kind ∈ {research_paper, coffee_book, purity_brain, reva_skill, coa, product_pdf, faq, web, review, canon}`. `valid_from`/`valid_until` enables retire-row pattern (no destructive updates; supersede instead).
- **`chunks`** — retrievable units, one embedding per row (`vector(1024)`, voyage-3-large). HNSW index for cosine.
- **`canon_qa`** — curated Q&A cache. Checked before LLM path. `status ∈ {draft, active, deprecated}`; only `active` is visible to non-editors.
- **`messages`** — every chat turn. Holds observability fields (latency, tokens, cost, confidence, classification, escalation) and feedback fields (`user_rating`, `editor_label`).
- **`escalation_events`** — audit trail. Trigger-populated when `editor_label` or `escalated` changes.
- **`rate_limits`** — per-user-per-minute counter. `check_and_increment_rate_limit()` RPC is the only writer.
- **`coas`** — structured COA rows for the Reports page.
- **`reviews`** — stub for mined customer reviews.
- **`update_jobs`** — cron + manual ingestion job log (global 3/day manual cap).

Views worth knowing:

- `bibliography_view` — one row per DOI (DISTINCT ON dedup; see migration 0003).
- `daily_chat_metrics` — per-day rollup for the Metrics page.
- `promotion_candidates` — thumbs-up messages not yet canon (editor queue).
- `canon_misses` — thumbs-down + escalations (editor triage).
- `escalation_queue_view` — enriched escalation queue with editor identity + event count.

## RLS in one rule

Non-editors see their own stuff. Editors see everything. Details in `dashboard/app/supabase/RLS.md`. Run `npm run verify-rls` to probe live.

## Chat pipeline

`/api/chat` is the hot path. Flow:

1. Auth check → `auth.uid()`
2. `checkChatRateLimit()` → RPC, 429 if exceeded
3. `classify()` (Haiku, fast) → category (coa | blend | health | product | other) + whether to require fresh retrieval
4. `findCanonHit()` → if a canon_qa row scores >0.80 similarity, short-circuit with that answer
5. Otherwise `retrieveChunks()` → top-k from pgvector, optionally filtered by source kind
6. `generateAnswer()` → Sonnet with chunks as context, returns answer + confidence + cited chunks + insufficient_evidence flag + token counts
7. Insert into `messages`; escalate if confidence < 0.55 or insufficient_evidence

The confidence floor lives at the top of `app/api/chat/route.ts` — change there, not in the LLM prompt.

## Feedback loop

Users can thumbs up or down on any completed turn (`/api/chat/feedback` → sets `messages.user_rating`). The trigger `messages_restrict_user_update` ensures a non-editor can only change the rating columns, not editor fields.

Editors triage in `/editor`: label as good/bad or promote to canon. Promote writes a `canon_qa` row at `status='draft'` so it's not live until reviewed.

`promotion_candidates` view = thumbs-up messages not yet in canon. Processing that view weekly is how the canon grows.

## Ingestion cadence

- `reva/` refreshed when `SKILL.md` changes — manual copy into `knowledge-base/reva/`
- `purity-brain/` refreshed when Coda Org DNA / Brand Guidelines / Core Instructions / Content tables change — re-run the Coda → markdown extraction
- `coffee-book/` refreshed when Ildi publishes a revision
- `research/` refreshed via Drive keyword sweeps; `manifest.json` tracks what's ingested
- `bibliography/` xlsx catalog refreshed when Jeremy's master sheet changes; `npm run import-bibliography` loads it
- Daily cron via `/api/update/cron` + optional manual button via `/api/update/manual` (3/day global cap)

## Known intentional oddities

- **Duplicate DOIs across sources rows** — the same research paper is deliberately ingested under multiple chapter folders because chapter context matters for retrieval. `bibliography_view` dedupes by DOI for the UI. See migration 0003.
- **Five residual research papers without DOIs** — tracked in `knowledge-base/README.md` under "Dedupe pass". Fix = add DOI to `scripts/manual_doi_overrides.json`, rerun `npm run dedupe-research`.
- **Ch18 trigonelline paper mislabeled** — `research/by-chapter/18/trigonelline-ch18.txt` is actually a book-editing proof, not a primary study. Re-identify and replace.
- **No author data on bibliography rows** — citation export (`CiteButton`) emits BibTeX + plain text based on title/year/DOI only; reference managers fill in authors from the DOI.

## Env vars

Required in `.env.local` and Vercel:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server-only, never exposed
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
GOOGLE_DRIVE_CREDENTIALS=           # JSON, base64-encoded service account
CHAT_RPM_LIMIT=30                   # optional, default 30
CHAT_RPD_LIMIT=500                  # optional, default 500
CRON_SECRET=                        # gates /api/update/cron
```

Test RLS probe additionally needs:

```
SUPABASE_TEST_USER_EMAIL=
SUPABASE_TEST_USER_PASSWORD=
SUPABASE_TEST_EDITOR_EMAIL=
SUPABASE_TEST_EDITOR_PASSWORD=
```

## Scripts

From `dashboard/app/`:

```
npm run dev                    # local dev (Turbopack)
npm run build                  # production build
npm run lint
npm run ingest                 # re-embed the KB (full pass)
npm run embed-canon            # recompute canon_qa.question_embed
npm run import-coas            # ingest /knowledge-base/coas/ xlsx files
npm run import-bibliography    # load the 448-row bibliography xlsx
npm run dedupe-research        # reconcile research/ corpus with bibliography DOIs
npm run verify-rls             # live-probe the RLS matrix
```

## Voice and tone for generated content

When generating Purity or CHC content from this app, activate the `reva` skill first (it's at `/mnt/.claude/skills/reva/` when Claude is working locally). That skill carries Jeremy's voice, CHC framing, evidence hierarchy, and the health-claim compliance rules.

No em dashes in user-facing chat copy — it's a Purity brand rule.

## Don't do

- Don't amend commits; create new ones.
- Don't run `supabase db reset` on the cloud project.
- Don't log PII to `chat_events`-style tables — we don't have one and `messages.metadata` is not meant for it either.
- Don't expose the `SUPABASE_SERVICE_ROLE_KEY` to the client bundle. Server routes only.
- Don't `GRANT UPDATE` broadly on `messages` — the trigger expects column-limited writes via RLS only.
