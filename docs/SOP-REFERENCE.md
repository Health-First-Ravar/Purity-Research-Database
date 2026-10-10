# Purity Research Hub, SOP Reference

The facts behind the user SOP ("How to Use the Purity Research Hub: Step-by-Step
Guide", Pathwright), taken from the code on `overhaul` (2026-10-09, after the
switch-over). Each fact names the file it comes from, so the SOP can be checked
when the app changes. Replaces the July reference for the old Purity Dashboard.

Course draft (paste-ready lessons and a screenshot shot list):
https://claude.ai/code/artifact/525f41a8-3b14-40c3-be2b-cfd074c5f3ec

---

## Roles and access

Three roles (`lib/auth-roles.ts`, `lib/lab-data.ts` getHubRole). Legacy values
map: `researcher` to editor, `user` to customer service. The nav hides what a
role cannot use (`app/_components/NavLinks.tsx`, `SectionNavs.tsx`); each page
also enforces access.

| Page | Route | Customer service | Editor | Admin |
|---|---|---|---|---|
| Home | `/` | yes | yes | yes |
| Ask | `/ask` | yes | yes | yes |
| Ask deep mode (Reva) | `/reva` | "Reva is admin-only." | "Reva is admin-only." | yes |
| COA quick view: Overview, Health Grade standard, How we test | `/coa`, `/coa/standard`, `/coa/how` | yes | yes | yes |
| Product page | `/coa/<product>` | yes, no internal refs | yes | yes |
| Green lots | `/coa/green` | redirected to `/coa` | yes | yes |
| Claim library, Check a claim | `/claims`, `/claims/check` | yes | yes | yes |
| Research library: Papers | `/library` | yes | yes | yes |
| Browse by topic | `/library/topics` | message only | yes | yes |
| Atlas triage | `/atlas/triage` | redirected to `/library/topics` | yes | yes |
| Admin overview | `/admin` | redirected to `/` | yes | yes |
| Review queue | `/editor` | "Editor role required." | yes | yes |
| Canon answers, Bulk add | `/editor/canon`, `/editor/canon/bulk` | "Editor role required." | yes | yes |
| Question trends | `/heatmap` | "Editor role required." | yes | yes |
| Sync status | `/admin/sync` | redirected to `/` | yes | yes |
| Metrics | `/metrics` | "Admin role required." | "Admin role required." | yes |
| Users | `/editor/users` | "Admin role required." | "Admin role required." | yes |
| Manual update button (header) | POST `/api/update/manual` | hidden | yes | yes |
| Ask Reva helper (floating, bottom left) | `app/_components/RevaClippy.tsx` | yes | yes | yes |

Data scope inside shared pages:

- Home and COA quick view: "Needs attention" and "Contaminants over limit" cover
  finished products for customer service, all samples for staff
  (`lib/lab-data.ts` attentionItems, homeKpis).
- Product page: internal references (file names, e-mail threads) and set-aside
  reasons show to staff only and never print (`app/coa/[product]/page.tsx`).
- Ask: customer service gets "not available in this view" for green lots, and
  COA chunks are restricted to Purity products (`lib/coa-scope.ts`, RLS).
- Check a claim: a staff check of a library claim's unchanged wording saves the
  library verdict; customer service checks save to their own recent checks
  (`app/claims/check/page.tsx`). Recent checks: own, or everyone's for staff.

## Header and navigation (`app/layout.tsx`)

- Title "Purity Research Hub", tagline "Research, support, COA questions and
  claims in one place".
- Right side: theme toggle, Manual update (staff), Sign out (signed in).
- Tabs: Home, Ask, COA quick view, Claims, Research library, Admin (staff).
- Sub-tabs (`app/_components/hub.tsx`, `SectionNavs.tsx`):
  - COA quick view: Overview, Green lots (staff), Health Grade standard, How we test.
  - Claims: Claim library, Check a claim.
  - Research library: Papers, Browse by topic (staff).
  - Admin: Overview, Review queue, Canon answers, Question trends, Sync status,
    Metrics and Users (admin).

## Sign-in, invitations, password reset

- Invite-only. Admin adds a user in Users; a blank password sends the
  invitation e-mail "You have been invited to the Purity Research Hub", link
  valid 24 hours (`lib/email.ts`, `app/api/editor/users/route.ts`).
- Reset: "Forgot password?" then "Send reset link"; e-mail "Reset your Purity
  Research Hub password", link valid 1 hour (`app/api/auth/forgot-password/route.ts`).
- Both links go to `/auth/confirm` (token verified server side), then
  "Create your password" (`/auth/update-password`, minimum 8 characters,
  "Set password & sign in").
- Spent or expired link: "That link has expired or was already used. Use Forgot
  password to get a new one." (`app/login/LoginForm.tsx`).
- After sign-in the Hub opens `next` (in-app paths only), default `/ask`.
- Sign out: POST `/auth/signout` ends the session server side.

## Ask (`app/ask`, `app/api/chat/route.ts`)

- Order: classify, canon cache (curated answers returned as written), lab
  evidence from Brian's tracker, research retrieval, generation, guardrail
  repair, log to `messages`.
- Route label under the answer: COA, Research or Customer answer
  (`lib/rag/ask-route.ts`); "curated answer" for a canon hit.
- Streaming (`stream: true`, on `overhaul` from `24af366`): stage labels
  "Reading the question…", "Looking up lab results and research…",
  "Writing…", "Checking the wording…"; the lab panel shows before the text;
  only guardrail-clean sentences stream (`lib/rag/answer-stream.ts`).
- Escalation ("escalated to Ildi / Jeremy"): confidence below 0.30
  (`HARD_CONFIDENCE_FLOOR`), or the model recommends escalation, or
  insufficient evidence on a COA or time-sensitive question.
- Context: last 3 turns; "Reset conversation" clears it (in-page Clear/Keep).
- Rate limits (`lib/rate-limit.ts`): 30 a minute, 500 a day per person
  (`CHAT_RPM_LIMIT`, `CHAT_RPD_LIMIT`).
- Ratings: thumbs up, thumbs down (saves at once, optional note); down-rated,
  escalated and insufficient-evidence answers feed Canon answers, Gaps.
- Answer rules (`lib/rag/generate.ts`, `lib/rag/guardrails.ts`): hedged health
  wording, no unverified QA procedure, no offers to notify, no superlatives or
  lab praise, no blend rankings except as lab numbers, no dashes, no external
  regulatory limits (`lib/rag/sanitize.ts`).

## COA quick view (`app/coa`)

- Source: Brian's Lab Testing tracker, read by the "Purity lab sync" scheduled
  task, weekdays 9:46 AM and 2:46 PM ET; footer "COA data mirrors Brian's Lab
  Testing tracker, last synced …".
- Overview: Needs attention; Testing compliance (Current, Due within 60 days,
  Full panel overdue, No full panel on file; full panel = metals + a mycotoxin +
  acrylamide, due every 12 months, `lib/lab-status.ts` panelState, isFullPanel);
  Product by analyte grid (Pb, Cd, As, Hg, OTA, AFB1, acrylamide, glyphosate,
  yeast, mold, CGA); Reporting-limit flags; Coverage gaps (melanoidins, NMP,
  furan, PAHs not on any panel; core blends never tested or older than 24 months).
- Product page: "Substantiation packet", Open in Brian's tracker, Print packet;
  Full panel, Next due, Tests on file, Worst latest result; Product facts;
  Latest result per analyte with Certificate links ("Certificates are shared as
  whole PDFs only (Eurofins terms)"); Test history.
- Health Grade standard: finished product and Green Arabica Requirements v2.5.
- How we test: triggers, panels, and the line "every green lot is tested for
  mycotoxins before roasting, and each blend gets a full contaminant panel at an
  independent lab once a year. Not 'every batch'." (open: confirm with Ildi).

Status words (`lib/lab-status.ts` evalOne, LABEL, analyteLabel):

| Status | Rule |
|---|---|
| Over limit | value above the limit (green ceiling: at or above) |
| Near limit | above 80% of the limit |
| Within limit | measured, at or below 80% |
| Not detected | "<" or ND, reporting limit at or below ours |
| LOQ above limit | "<" with a reporting limit above ours |
| Detected | a flag-when-detected analyte found |
| Cleared on retest | over or near, retest within limit or not detected |
| Below minimum | green CGA under 3.0% or caffeine under 0.9% (flagged for review, not failed); decaf caffeine at or above 0.1% fails |
| Awaiting sample | ordered, no result |
| Not scored (set aside) / Not scored (Sacred Cups) | excluded record / Sacred Cups |

## Claims (`app/claims`, `lib/claim-verdict.ts`, `app/api/audit/route.ts`)

- Claim library: Brian's claims with risk, channel, placements, evidence needed;
  filters Risk, Category, Channel, Product, Research verdict; 60 rows per page.
- Check a claim: Draft, Context (newsletter, module, chat answer, product
  page, other), "Check claim"; result shows Verdict, Compound Reasoning Stack
  (Mechanism, Bioavailability, Evidence, Practical, weakest link), Compounds,
  Regulatory flags, Evidence tier (1 pre-registered RCT to 7 in vitro / cell
  culture), "Reva's reconstructed claim", Cited evidence.
- Verdicts: Do not use (cure / prevent / treat language), Needs rewording (any
  other flag), Weak evidence (no flags, tiers 5 to 7 or none), Supported as
  worded (no flags, tiers 1 to 4), No health claim.
- Same draft, context and auditor version within 30 days returns the stored
  audit. Uses the Ask rate limit.

## Research library (`app/library`)

- Catalog: filters topic, category, year range, rights (any, open access /
  free, Open Access, Free via PMC, Free access, Subscription only), has PDF,
  open access only, title search; sortable Year, Title, Topic, Rights; up to 500
  rows. Titles from `sources.metadata.display` (Crossref) where present, stored
  title on hover. "PDF in Drive" needs access to the research folder; DOI links
  to doi.org; cite menu copies BibTeX or plain text.
- Search: semantic search over chunks, similarity threshold 0.45.
- Browse by topic (staff): topic map; drag saves the layout; Triage routes
  unmapped topics and reviews cross-link candidates.

## Admin

- Review queue (`/editor`): "Editor: escalation queue" and "Recent messages";
  labels good, bad, promote to canon (confirm, creates a draft).
- Canon answers (`/editor/canon`): Gaps (write an answer, "Save as canon
  draft"; the failed answer is never promoted as is), Drafts (Edit, Approve,
  Save and approve, Reject), Active (Edit, Deprecate), Deprecated (Restore);
  Bulk add takes Q:/A: blocks.
- Question trends (`/heatmap`): tiles Topics, Topics without canon, Canon gaps
  (no canon and asked 3+ times in 30 days), Msgs (30d), Priority topics; sorts
  priority, most asked, highest miss-rate, gaps first.
- Sync status (`/admin/sync`): Last good run, Records, Claims, Newest test date;
  runs labeled imported, no change, rejected or failed; "The sync needs a look"
  after more than 3 days without a good run or after a failed import
  (`app/admin/sync/health.ts`).
- Manual update (`app/api/update/manual/route.ts`, `lib/sync.ts`): editor+,
  global cap 3 a day (midnight UTC); pulls research and product PDFs from Drive
  (not the COA folder since the switch-over) and fills readable titles for new
  papers; shows "Checked N, added N, updated N." or "Capped (3/day)".
- Metrics (admin): periods 7, 30, 90 days or a year; Conversations, Answered
  confidently, Customer satisfaction, Activity over time, AI cost, Average
  response time, Quick answers ready, Waiting on a person, Good answers to
  save, Answers that need work.
- Users (admin): add (blank password sends the invitation), change role, edit
  name, set password, delete; shows last sign-in.
- Ask deep mode (`/reva`, admin): sessions; modes Create, Analyze, Challenge.

## Old URLs (`next.config.ts`, 308 with the query kept)

| Old | New |
|---|---|
| /chat | /ask |
| /reports/limits | /coa/standard |
| /reports/assign | /admin |
| /reports, /reports/* | /coa |
| /bibliography | /library |
| /audit | /claims/check |
| /atlas | /library/topics |

## Open decisions (Ildi)

- Testing-frequency wording (How we test, Ask no longer says "per-lot COAs" or
  "tests every lot").
- Ask open to editors; Browse by topic staff-only.
