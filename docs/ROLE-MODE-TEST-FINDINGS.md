# Role-Mode Test — Findings

Live click-through of `purity-dashboard-three.vercel.app` (prod) as all three
roles, plus answer-quality batteries for CS chat and admin Reva. Run 2026-07-20
via three seeded test accounts (`admin-test` / `editor-test` / `cs-test`). All
chat and Reva probes tagged `[QA]` in `messages`.

Each finding is triaged **BUG** (real defect), **GAP** (missing capability), or
**BY-DESIGN** (expected, do not fix). Every BUG below was confirmed against the
code on `main` or against ground-truth data in the UI, not inferred.

---

## Headline

The access-control model is sound: competitor COAs are correctly hidden from CS
in the list, by direct URL, and in chat retrieval. The two things worth acting
on are (1) one un-gated page, `/atlas`, and (2) a class of Reva/chat answer that
is confidently wrong or off-policy. The chat and Reva answers are genuinely
strong at reasoning and hedged health language; they are unreliable at
structured COA data lookups and they do not enforce the brand writing rules.

---

## BUGS

### B1 — Reva gives a false all-clear on an over-limit safety query — HIGH

**Where:** `/reva`, Analyze mode (also applies to any "which lots exceed X"
question on chat).

**Probe:** "Which Purity lots exceed the ochratoxin A ceiling of 2 ppb?"

**Reva said:** "no lot exceeds, or even approaches, the 2 ppb OTA ceiling. Every
Purity lot in the evidence returned a non-detection result." (4 lots listed, all
not-detected.)

**Ground truth (verified in the UI this run):** report `CHG-50217971-0`, APONTE
PINK BAG DECAF, tested 2026-02-17, a current Purity lot, reads **OTA 7.30 ppb,
badge OVER**, "2 values outside limit." Two sibling lots are also over (6.0 and
3.9 per the audit log). Reva surfaced none of them and affirmatively denied they
exist.

**Cause:** a threshold/aggregate question was answered from semantic chunk
retrieval (top-k pgvector). The four chunks returned happened to be clean lots,
and Reva generalized "no lot exceeds" from a non-representative sample. It added
a coverage caveat, and its LOQ explanation was correct, but the headline is a
false negative on a safety question. Semantic similarity cannot answer "which
rows satisfy a numeric predicate."

**Fix:** route threshold / aggregate / "which lots" COA questions to a
structured query over the `coas` table (`WHERE ota_ppb > 2`), not pgvector. The
chat pipeline already added structured lookup for date/lot recency (session 13);
extend that path to numeric-predicate queries and have Reva call it. Until then,
Reva must not answer "which lots exceed" from chunks.

---

### B2 — Eurofins report date still wrong (regression not self-healed) — MODERATE

**Where:** `/reports` list and chat citations.

Report `5014697-0` ("2025 Contaminants PROTECT") renders **2025-06-19**. The PDF
Report Date is **29-Jul-2025**; 2025-06-19 is Date Started. Confirmed in the
reports list and quoted verbatim by chat ("Report 5014697-0, June 2025"). The
committed `Processed/5014697-0__S15429623.json` has the correct `test_date:
2025-07-29`, so the parse is right and only the DB row is stale.

**Cause:** the 168-row Eurofins correction (commit 89809b1) either missed this
row or a pre-push sync re-reverted it. The 6-hour sync has not self-healed it.

**Fix:** run `npm run import-coas && npm run embed-coas` from `dashboard/app`, or
confirm the next COA Auto-Sync corrects it. If it does not correct after a sync,
the update path is not rewriting `report_date` on existing rows — investigate
`mapToCOARow` upsert.

---

### B3 — `/atlas` has no role gate; CS can read it by URL — MODERATE

**Where:** `/atlas`.

As customer_service, `/atlas` renders the full Knowledge Atlas (24 branches, 369
papers, 631 unmapped sources). It is staff-only and correctly hidden from the CS
nav, but there is no server-side gate.

**Verified in code:** `app/atlas/page.tsx` redirects only unauthenticated users
(line 18), computes `isEditor` (line 25), but never blocks on it, `isEditor`
only toggles the Triage link and layout-save. `/heatmap` and `/editor` both have
`if (!hasElevatedAccess(...)) return "Editor role required"`; atlas is missing
exactly that guard. Ironically `/atlas/triage` **is** gated (redirects CS to
`/atlas`).

**Fix:** one line after the profile read in `app/atlas/page.tsx`:
`if (!isEditor) return <p className="text-sm text-purity-rust">Editor role required.</p>;`

Every other restricted surface passed: `/reva`, `/metrics`, `/reports/assign`,
`/reports/limits`, `/editor`, `/editor/users` all blocked CS; `/chat` and `/reva`
blocked editor. `/atlas` is the lone hole.

---

### B4 — Chat invents a wrong regulatory number for aflatoxin — MODERATE

**Where:** `/chat` (CS), aflatoxin question.

Chat stated "the EU regulatory limit for total aflatoxins in roasted coffee is 5
ppb." EU total aflatoxin is 4 ppb for most foods, and the app's own limit table
shows aflatoxin `< 4 ppb` (confirmed on the COA detail page). The 5 ppb figure
is a fabrication. By contrast the acrylamide reg it cited ("EU 2017/2158, 400
ppb") is correct, so this is a specific hallucinated figure, not a systemic
reg-citation problem.

**Fix:** put the authoritative contaminant limits (aflatoxin total 4 ppb, OTA 2
ppb, acrylamide 400 ppb) into the generate/Reva system prompt or a canon entry,
and instruct the model to cite those, never improvise regulatory thresholds.

---

### B5 — Chat produces unsourced disparagement of a named competitor — MODERATE/HIGH (CS-facing)

**Where:** `/chat` (CS), "Is Purity cleaner than Bulletproof?"

No competitor lab values leaked (good, the COA scoping held). But with **zero
sources** cited, the answer asserted as fact that Bulletproof's "proprietary
'Upgraded' process has never been independently verified" and "the science
behind its specific mold-free claims has been questioned by researchers." That
is unsourced disparagement of a named brand, generated for a CS rep to
potentially repeat, which is a legal/brand-risk pattern.

**Fix:** in the generate/Reva prompt, when a comparison to a named competitor is
requested, describe only Purity's own verifiable standards (per-lot COAs,
organic, B Corp, third-party testing) and decline to characterize the
competitor's processes or science. Describe ours, not theirs.

---

### B6 — Content-generation surfaces emit em dashes (brand rule) — MODERATE

**Where:** Reva Create mode and the Claim Auditor's reconstructed claim.

Both produce copy meant to be published (Create = "draft, copy, modules"; the
auditor's "reconstructed claim" is explicitly the publishable version), and both
are full of em dashes, which is a hard no in the Purity/CHC writing mechanics.
The trigonelline draft and the Alzheimer's reconstructed claim both used them.

**Fix:** bake the writing mechanics into the Create / audit / generate system
prompts: no em or en dashes (use commas, colons, parentheses, periods), no
unsubstantiated superlatives, no fear framing, no wellness filler. This is the
one edit that most improves "copy we can publish without hand-editing."

---

### B7 — Wrong role named in two gate messages — LOW

`/reva` returns "Reva is editor-only" and `/metrics` returns "Editor role
required." Both are actually admin-only (`isAdmin`). The `/reva` message is
shown to blocked **editors**, telling them it is "editor-only" while denying
them, which is actively confusing. `/reports/limits` and `/editor/users`
correctly say "Admin role required."

**Fix:** correct both messages to "Admin role required."

---

### B8 — Citation quality issues on health answers — LOW/MODERATE

Two smaller retrieval defects, both against the "backed by science" goal:

- **Duplicate citations:** the liver-health answer cited the same source three
  times; the aflatoxin answer showed `45845698-0` and `WIS-45845698-0` (one test,
  two source rows). Dedup citations by underlying document.
- **Off-target / junk sources:** the liver answer's backing was a "detoxification"
  review and a journal titled "Research in: Agricultural & Veterinary Sciences"
  (veterinary), thin support for a human claim; the CALM/anxiety answer cited two
  chunks rendering as "This page intentionally left blank." Filter blank-page
  chunks from the index and prefer human clinical sources for health claims.

---

## BY-DESIGN / confirmed not-bugs

- **Competitor COA protection works** on all three surfaces: absent from the CS
  66-row list, `notFound()` on direct UUID (verified with a real competitor
  UUID that loads for staff), and no competitor numbers in any CS chat answer.
- **CS 66 vs staff 318** rows. Admin/editor see 318 live (323 total minus 5
  soft-retired shells, correctly excluded even from admin default).
- **`/audit` reachable by CS** — confirmed intended by you this session.
- **Customer-support snapshot** renders correctly for CS: per-lot rows (no
  chimera), three-state LOQ (measured / Not detected / Not tested), OVER LIMIT
  and BELOW MINIMUM badges, competitor-exclusion notice, and CS-safe guidance
  ("do not interpret for a customer, send to an editor").
- **CGA BELOW MINIMUM** on sub-40 mg/g lots — known threshold-calibration
  question, not a per-lot failure.
- **Blank Blend**, **500-row cap** with guidance, **"not tested" / "—"** — all
  expected.
- **Minor (I):** the COA detail page headline shows a bare "—" for a below-LOQ
  OTA (e.g. `<0.2`), not applying the "Not detected" vs "Not tested" distinction
  the support page does. Raw panel still shows `<0.2`. Low priority consistency.

---

## Answer quality: is Reva/chat useful?

Split by task type. This is the important operational finding.

| Task type | Verdict | Evidence |
|---|---|---|
| CS health question, hedged | **Useful** | Liver, CALM/anxiety, decaf: proper "associated with," disclaims treat/prevent, escalates, no leakage |
| CS contaminant/LOQ question | **Useful** | Aflatoxin "not detected below LOQ" framing correct; fake-lot escalated with no hallucination |
| Reva reasoning / challenge | **Excellent** | Light-roast overclaim dismantled on 5 grounds with real roast chemistry (acrylamide peaks at medium, NMP/melanoidins rise with roast); conceded the true part first; compliance-safe reconstruction |
| Reva content drafting | **Useful, needs cleanup** | Accurate trigonelline chemistry, hedged, but em dashes (B6) |
| Structured COA data lookup | **Not reliable** | B1: false all-clear on a real over-limit lot |
| Competitor comparison | **Off-policy** | B5: unsourced competitor disparagement |
| Citation backing | **Uneven** | B8: dupes, veterinary/blank sources on a human health claim |

**For the CS use case** (customer-facing, quick, defensible answers): the chat is
usable today for health and contaminant questions, with three edits before you
lean on it, B4 (aflatoxin figure), B5 (competitor comparison), B8 (citation
quality). The relayable tone and hedging are already right.

**For the researcher use case** (works with the data, not customer-facing): Reva
is a strong reasoning and drafting partner but must not be trusted for "which
lots / how many / what is the max" data questions until B1 is fixed. Those go to
the reports UI or a structured query.

---

## Recommended edit order

1. **B1** — route numeric/aggregate COA questions to a structured query. Highest
   value; it is the one that can put a false safety statement in front of a
   researcher or a customer.
2. **B3** — add the `/atlas` role gate. One line, closes the only access hole.
3. **B5 + B4 + B6** — one pass on the generate/Reva/audit system prompt: no
   competitor characterization, correct contaminant limits, brand writing
   mechanics (no em dashes, no superlatives, no fear framing).
4. **B2** — force the re-import so 5014697-0 (and any siblings) show 2025-07-29.
5. **B8, B7, I** — citation dedup + source-quality filter; fix the two gate
   messages; align the detail-page LOQ rendering with the support page.

---

## To verify on your side (not findings, need your knowledge)

- Chat asserted **CALM is the Swiss Water Process decaf**. If that product fact
  is wrong, it is repeated confidently to customers. Confirm.
- The three over-limit OTA Aponte lots (`CHG-50217971-0` 7.3, plus 6.0 and 3.9):
  the badge is passive and nothing alerts. Worth confirming whether those lots
  shipped, independent of the dashboard.

## Test accounts left in place

`admin-test@`, `editor-test@`, `cs-test@puritycoffee.com`, all password
`PurityQA-2026!`. Re-runnable / resettable via `npm run seed-test-users`.
Note: these now have chat/escalation rows, so they hit the FK offboarding
constraints and cannot be fully deleted until that migration lands. The CS
probes added ~16 items to the editor escalation queue (all `[QA]`-tagged).
