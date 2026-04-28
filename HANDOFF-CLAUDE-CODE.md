# Handoff — Purity Lab Data → Claude Code

**Prepared:** 2026-04-24 (late night polish session, Jeremy Rävar)
**Target agent:** Claude Code, local to Jeremy's MacBook Pro (M1)
**Working directory:** `/path/to/Purity-Lab-Data` (repo root — what was `/sessions/.../mnt/Purity-Lab-Data` in the Cowork sandbox)

You are picking up a mostly-finished Next.js + Supabase dashboard (`dashboard/app/`). The previous agent (me, in Cowork) ran a large polish pass — dark mode, toast provider, mobile responsiveness, accessibility, URL-persisted filters — none of which was typechecked because the sandbox had no `node_modules`. Your first job is to make sure it actually compiles, then to close the remaining real gaps before this ships.

---

## Before you start

**Required reading, in order:**

1. `CLAUDE.md` (repo root) — architecture, RLS model, ingestion cadence, don't-dos
2. `dashboard/HANDOFF-2026-04-23.md` — the two addenda at the bottom describe every file touched in the polish pass
3. `dashboard/app/supabase/RLS.md` — the access matrix

**Environment assumptions:**

- `.env.local` at `dashboard/app/` is populated per the "Env vars" section in `CLAUDE.md`
- Supabase cloud project has migrations `0001` through `0006` applied (verify with `supabase migration list`)
- `node_modules` may need a clean install — the last session had no network

**Don't-dos:**

- Don't amend commits. Create new ones.
- Don't run `supabase db reset` on cloud.
- Don't push to `main` without Jeremy's ack.
- Don't expose `SUPABASE_SERVICE_ROLE_KEY` to the client bundle.
- Don't skip hooks (`--no-verify`) on commits.
- Don't `git add -A` blindly — review the diff before each commit.

---

## Priority 0 — Make it compile (est. 30–90 min)

The previous session was careful-inspection only. Before anything else:

```bash
cd dashboard/app
npm install                 # or npm ci if lockfile is authoritative
npm run build               # the real test
npm run lint                # style check
```

Known suspects — check these first when build fails:

- **`tailwind.config.ts`** — I added a `purity.aqua` color token in the polish pass. Verify the whole `purity.*` palette is intact: `bean, cream, green, aqua, rust, slate, muted, ink, shade, paper, mist`. If any class like `text-purity-aqua` shows as unrecognized in the build, this is where to look.
- **`app/app/globals.css`** — references `theme('colors.purity.aqua')` in the `:focus-visible` rule. Will fail build if the token is missing.
- **`app/app/bibliography/_components/FormAutoSubmit.tsx`** — new file; uses `anchor.current?.closest('form')`. Should work, but I haven't exercised it.
- **`app/app/_components/Toast.tsx`** + **`ThemeToggle.tsx`** + **`ThemeScript.tsx`** — three new client components wired through `layout.tsx`. If any imports are wrong, `npm run build` will flag them.
- **`app/app/chat/_components/RatingButtons.tsx`** and **`app/app/editor/_components/LabelButtons.tsx`** — rewritten to use `useToast()` instead of inline status spans. Typescript should be fine, but verify.

**Acceptance:** `npm run build` exits 0. `npm run lint` exits 0 (warnings allowed; errors not). Boot `npm run dev`, visit `/chat`, `/editor`, `/metrics`, `/bibliography`, `/reports` — no console errors, dark mode toggle cycles cleanly (light → dark → system), no light-flash on reload.

Commit as: `fix(dashboard): repair polish-pass build after Cowork handoff`

---

## Priority 1 — Em-dash sweep (est. 15 min)

`CLAUDE.md` codifies: *"No em dashes in user-facing chat copy — it's a Purity brand rule."*

The polish pass introduced em-dash violations in toast messages rendered on `/chat`:

**`app/app/chat/_components/RatingButtons.tsx`:**

```ts
// line ~31
message: newRating === 1 ? 'Thanks — marked helpful.' : 'Thanks — flagged for editor review.',
```

Rewrite to drop the em-dashes. Suggested:

```ts
message: newRating === 1 ? 'Thanks, marked helpful.' : 'Thanks, flagged for editor review.',
```

Also sweep for em-dashes across the entire `app/app/` tree and decide case-by-case. Strings likely to need attention:

- `app/app/_components/ManualUpdateButton.tsx` (none currently, but verify)
- `app/app/editor/_components/LabelButtons.tsx` — toast messages (`'Labeled bad. Thanks — this feeds the canon triage queue.'` → rewrite)
- Any placeholder or description text in page.tsx files rendered to end users

Use:

```bash
rg '—' app/app --type-add 'tsx:*.tsx' -t tsx
```

Then triage: if the string is in an editor-only page (`/editor/*`, `/metrics`) you can leave it; if it's in `/chat` or a shared component rendered on `/chat`, fix it.

**Acceptance:** No em-dashes in any string rendered on `/chat`. Shared components (`Toast`, `ManualUpdateButton`, `NavLinks`, `RatingButtons`) are clean.

Commit as: `style(dashboard): sweep em-dashes from user-facing strings per brand rule`

---

## Priority 2 — Canon draft review UI (est. 3–5 hours)

**The actual gap that matters.** Right now the feedback loop is half-built: `promote_to_canon` writes a `canon_qa` row at `status='draft'`, but there's no UI to surface drafts, review them, approve them, or reject them. Until this exists, the whole "editor promotes, it becomes canon" pitch is vapor — drafts accumulate and require manual SQL to go live.

### What to build

**Route:** `/editor/canon` (or a tabbed section inside `/editor` — your call, but a dedicated route is simpler).

**Server component renders:**

- A queue of `canon_qa` rows where `status='draft'`, most recent first
- For each row: the question, the answer (editable), source provenance (originating `message_id` if any, the promoting editor, `created_at`)
- An "Active canon" count and a "Drafts pending" count at the top

**Editor actions per row:**

- **Approve** → sets `status='active'` AND regenerates the question embedding via Voyage (so it's retrievable). This should be atomic.
- **Edit & approve** → updates the `answer` (and optionally `question`) before flipping to active. If `question` changed, embedding MUST be regenerated.
- **Reject** → sets `status='deprecated'` (soft delete pattern — preserves provenance)
- **View source** → if `origin_message_id` is populated, link to the original chat turn on `/editor` with the timeline visible

### API route to add

**`app/app/api/editor/canon/[id]/route.ts`**

- `POST` body: `{ action: 'approve' | 'reject', question?: string, answer?: string }`
- Editor-only (check `profile.role === 'editor'`)
- On `approve`:
  1. If `question` was edited, call `embedOne(question, 'doc')` via `lib/voyage.ts` and update `question_embed`
  2. Update `status='active'` on the `canon_qa` row
  3. Write an `escalation_events` row with `event_type='promoted'` and `canon_id` set
- On `reject`:
  1. Update `status='deprecated'`
  2. Write `escalation_events` with `event_type='rejected'` (add this to the event_type enum if needed — check migration `0006`)

### Client-side UX

- Use the existing `Toast` hook for success / error feedback
- Disable buttons during in-flight requests
- Optimistic UI: flip the row's status on click, revert on error
- After approval, the row can fade out (or move to an "Active" tab)

### Schema check

Run first to confirm column names match your plan:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'canon_qa'
order by ordinal_position;
```

If `origin_message_id`, `created_by`, or similar provenance columns are missing, add migration `0007_canon_provenance.sql`:

```sql
alter table canon_qa
  add column if not exists origin_message_id uuid references messages(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Backfill from messages if possible (best-effort — NULLs are acceptable)
```

Also verify RLS — editors should be able to `select`, `update`, and `delete` on `canon_qa`. Check `supabase/RLS.md` and add policies if missing.

### Retrieval gotcha

After a draft is approved, the existing `canon_qa` cache lookup in `app/api/chat/route.ts` (`findCanonHit`) should immediately start returning it. Verify that function filters on `status='active'` — if it doesn't, drafts will leak into production answers.

**Acceptance:**

1. `/editor/canon` lists all `status='draft'` rows with editor controls
2. Approving a draft: flips status, regenerates embedding, writes audit event, toast confirms, row leaves the queue
3. Editing answer then approving: new answer is persisted, embedding regenerated if question changed
4. Rejecting: flips to deprecated, writes audit event
5. New `promotion_candidates` → `promote_to_canon` → `/editor/canon` approval flow works end-to-end
6. `findCanonHit` filters on `status='active'` — a draft never short-circuits a real chat query
7. Unit/smoke test: promote a message via `/editor`, approve it via `/editor/canon`, re-ask the question on `/chat`, confirm the answer is served from canon with `source: 'canon'` in the meta

Commit as (two commits — schema, then UI):
- `feat(canon): add canon_qa provenance columns + RLS for draft review` (if migration needed)
- `feat(editor): canon draft review UI with approve/edit/reject flow`

---

## Priority 3 — Pagination on `/editor` (est. 30–60 min)

Both queues on `/editor` use hard `.limit(50)` / `.limit(100)`. At any meaningful volume, editors silently miss work. No UI affordance signals there's more.

**What to build:**

- Add `?escalated_before=<cursor>` and `?recent_before=<cursor>` search params (cursor = `created_at` of the last visible row)
- "Load more" button at the bottom of each queue that navigates with the cursor
- Optional: a count badge at the section header (`SELECT COUNT(*)` for escalated + unlabeled, runs cheap)

**Implementation:**

Cursor pagination is simpler than offset and avoids race conditions on a list that's actively growing:

```ts
let q = supabase
  .from('messages')
  .select('...')
  .eq('escalated', true)
  .is('editor_label', null)
  .order('created_at', { ascending: false })
  .limit(50);

if (params.escalated_before) {
  q = q.lt('created_at', params.escalated_before);
}
```

Then "Load more" is an `<a>` with `href="?escalated_before=<last_row.created_at>"`.

**Acceptance:** Both queues paginate cleanly. Load-more preserves other search params. Count badge shows total pending (editor can see how deep the queue is).

Commit as: `feat(editor): cursor pagination on escalation and recent queues`

---

## Priority 4 — Bibliography sort controls (est. 45–90 min)

Year desc is hardcoded. Users should be able to click column headers to sort.

**What to build:**

- Add `?sort=<column>:<direction>` search param, default `year_published:desc`
- Whitelist sortable columns in the page component: `year_published, title, topic_category, drive_location, rights_download`
- Table headers become buttons. Clicking toggles direction; clicking a different column sets that column with `desc` default
- Show a small arrow glyph (`↑` / `↓` / `·`) next to the active sort column
- Add a secondary stable sort (`title asc`) always applied after the primary, so ties are deterministic

**Implementation:**

```ts
const SORTABLE = new Set(['year_published', 'title', 'topic_category', 'drive_location', 'rights_download']);
const [sortCol, sortDir] = (params.sort ?? 'year_published:desc').split(':');
const col = SORTABLE.has(sortCol) ? sortCol : 'year_published';
const dir = sortDir === 'asc' ? 'asc' : 'desc';

let q = supabase.from('bibliography_view').select('*')
  .order(col, { ascending: dir === 'asc', nullsFirst: false })
  .order('title', { ascending: true }); // stable tiebreaker
```

The header button can live in a small client component that reads the current sort from `useSearchParams` and writes a new one via `router.replace` — same pattern as `DebouncedTitleInput` and `FormAutoSubmit`.

**Acceptance:** Clicking any sortable header re-sorts the table, URL updates, sort state persists across filter changes, direction toggles on re-click.

Commit as: `feat(bibliography): sortable column headers with URL persistence`

---

## Priority 5 — Reports time-series charts (est. 3–4 hours)

`/reports` is currently a filtered table. The original roadmap called for charts — line charts of analytes over time, grouped by blend. That's the actual value-add of a COA reports page for a health-first brand.

**What to build:**

Above the existing table on `/reports`:

- A time-series line chart using `recharts` (already referenced in CLAUDE.md for artifact contexts; add to `package.json` if not present)
- X-axis: `report_date`; Y-axis: current `analyte` value
- One line per distinct `blend` in the filtered dataset
- Reference lines or shaded bands for Purity's internal thresholds (if known; otherwise omit — don't fabricate)
- Tooltip on hover shows: date, blend, coffee_name, exact value, lab, lot_number
- Legend is clickable to toggle blends

Also useful:

- A "Download CSV" button that exports the current filtered result as CSV
- A "summary stats" strip above the chart: count, min, max, mean, stddev of the analyte over the filtered range

**Data layer:**

The existing `coas` table select is fine — no new query needed. Pass the same `rows` to both the chart and the table.

**Gotchas:**

- If the filtered dataset is empty or only one row, render an `EmptyState` instead of a degenerate chart
- Dark mode: recharts needs explicit `stroke` + `fill` colors; use CSS variables or conditional props via a `useTheme` hook reading `document.documentElement.classList.contains('dark')`
- The chart will be client-rendered; mark the chart component `'use client'` but keep the page a server component that passes data in as props

**Acceptance:**

- `/reports` shows a readable line chart when ≥ 2 COA rows match the filter
- Chart updates when filters change (same form mechanism)
- CSV download works and matches the visible filter state
- Dark mode renders legibly

Commit as: `feat(reports): time-series chart per analyte with blend lines + CSV export`

---

## Below-the-line — defer to a later cycle

Only pick these up if the Priority 0–5 list is clear and Jeremy hasn't come back with new asks.

- **Embedding version column on `chunks`** — add `embedding_model text default 'voyage-3-large'` for future-proofing when Voyage ships a breaking change. Cheap now; painful to backfill later.
- **Metrics timezone** — `daily_chat_metrics` rolls up by DB default TZ. Fix with `at time zone 'America/New_York'` in the view definition (migration `0008`), or expose a TZ param.
- **Manual-update cap race** — `/api/update/manual` counts `update_jobs` rows from today; two concurrent calls can both pass the check. Make it an atomic `UPDATE ... RETURNING` on a counter row, or use `FOR UPDATE` in a transaction.
- **Toast dedup** — identical consecutive toasts should collapse into one with a count badge.
- **Mobile nav scroll indicator** — add a CSS gradient fade on the right edge of `NavLinks` to hint at scrollable overflow.
- **`FormAutoSubmit` → router.replace** — currently triggers full-page navigation on every filter change. Rewrite to serialize FormData → URLSearchParams and call `router.replace` for smoother UX.
- **Editor "show retrieved chunks"** — on a thumbs-down message, editors can't see what the model actually retrieved. Add a collapsible panel per escalated message showing `cited_chunks` with kind + heading.
- **Playwright smoke tests** — login, send chat, thumbs, editor load, metrics load. 2 hours setup, catches 80% of future regressions.

---

## How to know you're done

**Definition of "ready to ship":**

- [ ] `npm run build` and `npm run lint` both clean
- [ ] Priority 1 sweep complete — no em-dashes on `/chat`
- [ ] Canon draft review UI exists, end-to-end flow works, `findCanonHit` filters on `status='active'`
- [ ] `/editor` paginates past the first 50/100
- [ ] `/bibliography` has sortable columns
- [ ] `/reports` has a chart above the table
- [ ] Dark mode still works across every page (regression check after all changes)
- [ ] Smoke test: fresh browser, log in as Jeremy, send a chat, thumbs-up, see it in `promotion_candidates` via editor, promote to canon draft, approve in `/editor/canon`, re-ask on `/chat`, confirm canon hit

**Commit cadence:** one commit per priority. Don't batch Priority 2 and 3 into one mega-commit — Jeremy may want to review canon separately.

**PR flow (if Jeremy wants one):** branch per priority (`polish/build-fix`, `polish/em-dashes`, `feat/canon-review`, `feat/editor-pagination`, `feat/bibliography-sort`, `feat/reports-charts`), stack them or merge serially.

---

## Stop conditions — when to wake Jeremy

- Any migration error applying to cloud Supabase
- Any RLS test failure in `npm run verify-rls`
- Build failures you can't resolve after two honest attempts
- Schema questions about `canon_qa` columns (don't invent columns — ask)
- Anything that would require changing the Purity brand palette or voice

---

## Reference

- Previous handoff: `dashboard/HANDOFF-2026-04-23.md` (two addenda at bottom document the polish pass file-by-file)
- Architecture: `CLAUDE.md` (repo root)
- RLS: `dashboard/app/supabase/RLS.md`
- KB structure: `knowledge-base/README.md`
- Voice / tone for any generated copy: activate the `reva` skill
- No em dashes in user-facing chat copy. Repeat: no em dashes in user-facing chat copy.

Good luck. Work in priority order and commit as you go.

— Previous agent (Cowork session, 2026-04-24)
