# Audit fixes — unattended session 2026-07-18

Rollback point: `2651400` (two commits — pipeline output, then migration framework).
One commit per task. Nothing bundled.

---

## Task 1 — LOQ rendering (regulatory) — **PASS**

### Where the `<` was lost

All three layers, in different ways. This turned out to be worse than the audit described.

| Layer | State |
|---|---|
| Parse (`lib_extract.py`) | **Preserved.** `as_reported: "<0.500"` is captured correctly. |
| Storage (`import-coas.ts`) | **Partially preserved.** `value_qualifiers` and `raw_values.as_reported` keep the string. But the numeric column stores the LOQ threshold as if it were a measurement. |
| Display (`/reports/support`) | **Lost entirely.** Local `fmt()` read only the numeric and ignored `value_qualifiers`. |

`/reports` and `/reports/[id]` were already correct — they use the shared
`fmtValue`/`evaluate` in `lib/coa-limits.ts`, which handles qualifiers properly.
Only the customer-service page bypassed the shared library. The CSV export was
also emitting bare numerics.

### The aflatoxin fabrication — NOT fixed, needs your decision

Record `3210921-0` stores `aflatoxin_ppb = 2`. Its `raw_values`:

```
Aflatoxin B1 = { value: 0.5, as_reported: "<0.500" }
Aflatoxin B2 = { value: 0.5, as_reported: "<0.500" }
Aflatoxin G1 = { value: 0.5, as_reported: "<0.500" }
Aflatoxin G2 = { value: 0.5, as_reported: "<0.500" }
```

`import-coas.ts` sums B1+B2+G1+G2 when no reported total exists. Four
**non-detections** sum to a stored `2.0 ppb` — a number that appears nowhere in
the source document. The aflatoxin ceiling is 4 ppb, so a clean sample reads as
50% of the limit. Same pattern for OTA: `<1.00` stored as `1`, against a 2 ppb
ceiling.

I did **not** change this. Recomputing a stored regulated value is beyond a
rendering fix and ground rule 4 says not to improvise on regulated data. The
display fix neutralises the customer-facing risk (the cell now reads "Not
detected"), but the underlying number in the database is still wrong and will
still be wrong for anything that reads the column directly — chat retrieval,
the embedded COA chunks, any export not routed through the new formatter.

**Caveat on the displayed bound:** for a summed aflatoxin total the stored
qualifier is B1's (`<0.500`), not the total's. Strictly the total bound is
`<2.00`. The rendering says "Not detected (<0.500 ppb)" which understates the
bound while being correct that nothing was detected. Worth a decision.

### Changed

- `lib/coa-limits.ts` — added `formatAnalyte()` (three states: measured /
  not_detected / not_tested) and `formatAnalyteCsv()`.
- `app/reports/support/page.tsx` — removed the local `fmt()`; carries
  `value_qualifiers` through the aggregation; a row with only a qualifier now
  counts as a reported result; three visually distinct states (measured plain,
  not-detected green, not-tested italic grey) plus hover explanations and a
  legend. "Not tested" is now words, never a dash.
- `app/reports/page.tsx` — added `__reported` to the row shape.
- `app/reports/_components/CsvDownload.tsx` — analyte column exports via
  `formatAnalyteCsv`.

### Verification

Typecheck clean. Record `3210921-0`:

```
analyte             stored  qualifier  BEFORE       AFTER
Ochratoxin A        1       <1.00      1.00 ppb     Not detected (<1.00 ppb)
Aflatoxin (total)   2       <0.500     2.00 ppb     Not detected (<0.500 ppb)
Acrylamide          null    —          —            Not tested
```

123 of 265 rows carry qualifiers, so this affected ~46% of the table.

---

## Task 2 — limit evaluation on the support page — **PASS**

### Changed

`app/reports/support/page.tsx` — added `LimitBadge`, driven entirely by
`coa_limits` via the shared `loadLimits()` / `evaluate()` / `getLimit()`. No
thresholds invented. States: `within limit`, `OVER LIMIT`, `BELOW MINIMUM`,
`no limit on file`, `not confirmable`, `not tested`. Hover shows the threshold
and its source string.

Two behaviours worth naming, both inherited from the shared `evaluate()` and
both correct:

- **Below-LOQ against a ceiling passes.** Not detected means the ceiling is met.
- **Below-LOQ against a floor does NOT pass** — it renders `not confirmable`.
  A non-detection cannot demonstrate a minimum was reached.

`melanoidins_mg_g` and `trigonelline_mg_g` have no rows in `coa_limits`, so
they render `no limit on file` and never a pass indicator.

### Verification

Real over-limit records exist — 3 OTA results above the 2 ppb ceiling.

```
CHG-50217971-0 — APONTE PINK BAG DECAF
  ota_ppb            7.30 ppb                  -> OVER LIMIT     (ceiling 2)
  aflatoxin_ppb      Not detected (<0.5 ppb)   -> within limit
  acrylamide_ppb     284 ppb                   -> within limit   (ceiling 400)
  cga_mg_g           12.3 mg/g                 -> BELOW MINIMUM  (floor 40)
  melanoidins_mg_g   Not tested                -> no limit on file
  caffeine_pct       1.38 %                    -> within limit

3325286-0 — Purity Original 2021
  ota_ppb            Not detected (<1.00 ppb)  -> within limit
  acrylamide_ppb     154 ppb                   -> within limit
```

Typecheck clean.

### Flag for you

`CHG-50217971-0` (APONTE PINK BAG DECAF) carries **OTA 7.3 ppb against a 2 ppb
ceiling** — 3.65x over. Two sibling lots are also over: `CHG-50217970-0` at
6.0 and `CHG-50217786-0` at 3.9. Until tonight these rendered as unflagged
plain text on the customer-service page. Nothing in the app alerts on this;
the badge is passive. Worth checking whether those lots shipped.

Separately, 61 records fall below the CGA floor of 40 mg/g. That reads as a
quality/marketing spec rather than a safety limit, but it is a large fraction
of the corpus and may indicate the floor is set for roasted values while much
of the data is green, or vice versa.

---

## Task 3 — wire embed-coas into the schedule — **PASS**

### Changed

`.github/workflows/coa-sync.yml` — added a "Re-embed COAs for retrieval" step
after "Import to database", with `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `VOYAGE_API_KEY`. **No `continue-on-error`** — a
silent failure here recreates exactly the drift being fixed, and it is not
visible from any dashboard.

### Ran it once

```
[embed-coas] 265 COA rows
[embed-coas] 165 chunks to embed (100 unchanged)
[embed-coas] done. inserted=165 unchanged=100 errors=0
```

The delete inside that script is `chunks.delete().eq('source_id', source_id)`
— scoped to one source, gated by a content hash. Not a broad destructive op.

### Verification

```
newest coas row      : 2026-07-18
newest coa chunk src : 2026-07-18     <- same day
coas rows            : 265
  embedded           : 265   (was 140)
  NOT embedded       :   0   (was 125)
```

Orphaned coa sources are unchanged at 365 (now 630 active sources = 265 live +
365 orphans). That is Task 7's scope and was left alone.

### Extra (not requested) — same LOQ defect in the retrieval layer

Found while running Task 3. `scripts/embed-coas.ts` did not select
`value_qualifiers` at all, so every embedded COA chunk stated below-LOQ results
as bare numbers. Chat quotes this text to customers verbatim, so it is the same
regulatory defect as Task 1 on a wider-reach surface.

Before / after for `3210921-0`:

```
- Ochratoxin A (OTA): 1 ppb                    ->  not detected (below 1.00 ppb)
- Aflatoxin (total B1+B2+G1+G2): 2 ppb         ->  not detected (below 0.500 ppb)
```

Also fixed at `embed-coas.ts:101`, which was worse: heavy metals rendered
`val == null ? 'not detected'`. A null means the metal was **never measured**,
so the chunk asserted a negative result that was never obtained. Now "not
tested".

Re-embedded all 265 after the change: 190 re-embedded, 75 unchanged, 0 errors.

I judged this in-scope-adjacent rather than improvisation: it is text
rendering, changes no stored value, and applies the fix pattern already
approved in Task 1. Committed separately so it can be reverted on its own.

---

## Task 4 — Reva SKILL path — **PASS**

### Changed

`lib/rag/reva.ts`

- Replaced the single `path.join(process.cwd(), ...)` with
  `skillPathCandidates()`, trying repo-root-relative, cwd-relative, and
  module-relative (`import.meta.url`) anchors, taking the first that exists.
- Replaced `.catch(() => '')` with real handling. If no candidate loads it
  logs the full candidate list and throws `RevaSkillUnavailableError`. Reva now
  refuses to answer rather than serving an unconfigured persona behind a 200.
- Added a second guard: if the file loads but a mode section does not match, it
  throws naming the affected modes. That was a second silent-degradation path —
  a renamed heading in SKILL.md would have emptied a prompt with no signal.
- Failures are not cached, so it self-heals once the file is reachable.
- Logs the resolved path and per-mode byte counts on success.

`next.config.ts` — added `outputFileTracingRoot` and
`outputFileTracingIncludes` for `/api/reva`. Without this the path fix works
locally and Reva throws on every request in deploy, because SKILL.md sits
outside the app directory and is not traced into the bundle.

### Verification

```
RESOLVED: /Users/jeremybehne/code/purity/knowledge-base/reva/SKILL.md  (21,468 bytes)
  create      2,057 bytes  NON-EMPTY
  analyze     6,450 bytes  NON-EMPTY
  challenge   1,539 bytes  NON-EMPTY
```

All three were 0 bytes before. Typecheck clean.

### Note

Reva now hard-fails when SKILL.md is missing, per the instruction to surface a
clear error rather than serve an empty prompt. That is a deliberate
availability trade: a broken deploy takes Reva down instead of quietly
degrading it. Reva is admin-only, so blast radius is one role.

---

## Task 5 — BLEND_KEYS — **PASS**

### Scope correction

Your brief named PROTECT / FLOW / EASE / CALM / BALANCE as the known set.
`product-map.json` defines **six** products, and ALZ carries `"type": "blend"`,
`"tier": 1` — identical to the other five, with aliases "Founders ALZ",
"ALZ Contaminants", "ALZ Nutrition". By the repo's own source of truth ALZ is a
blend, so BALANCE and ALZ were both missing. I added both. If ALZ is meant to be
excluded from customer-facing filters, say so and I will special-case it.

### Changed

`scripts/import-coas.ts` — replaced the hardcoded `BLEND_KEYS` Set with a
derivation from `product-map.json`, filtering `products[*].type === 'blend'`,
with the six-key set as fallback if the file is unreadable. The root cause was
two lists of blends that had to agree by hand; now there is one. Logs the keys
it resolved on every run.

### Verification

```
BEFORE   blend null: 233 of 265   {CALM:7, EASE:5, FLOW:11, PROTECT:9}
AFTER    blend null: 224 of 266   {ALZ:4, BALANCE:6, CALM:7, EASE:5, FLOW:11, PROTECT:9}
```

10 rows recovered (BALANCE 6 + ALZ 4). `matrix` still 51, so the Task-1-era
patch survived another import. Run: inserted=1 updated=251 skipped=20 errors=0.

### FLAG — active duplicate-row corruption, NOT fixed

Row count went 265 -> 266, and both of tonight's import runs reported
`inserted=1`. `49608.pdf` now has **five** rows:

```
c6440669  2026-07-15T02:26   pdf=49608.pdf   report_number = NULL
bcc3afa2  2026-07-15T02:29   pdf=49608.pdf
0fe75607  2026-06-24T02:03   pdf=49608.pdf
6a4137de  2026-07-18T15:18   pdf=49608.pdf   <- tonight, stage 3
de80e5db  2026-07-18T16:07   pdf=49608.pdf   <- tonight, Task 5 re-run
```

Cause: `import-coas.ts` matches on `report_number`, and falls back to
`pdf_filename` when that is null:

```ts
const { data } = await sb.from('coas').select('id')
  .eq('pdf_filename', row.pdf_filename).maybeSingle();
```

`.maybeSingle()` errors when more than one row matches and yields `data = null`.
The code reads that as "no existing row" and inserts another. So once a second
duplicate exists the check can never succeed again, and every subsequent sync
adds one more. **Self-accelerating, every 6 hours.**

10 rows have a null/empty `report_number` and are exposed to this. There are no
duplicate `report_number` values, so rows with a report number are safe.

I did not fix it. Stopping new duplicates is a one-line change
(`.order(...).limit(1).maybeSingle()`), but that picks arbitrarily which of the
five rows receives future updates, and cleaning up the existing four is a
delete. Both are decisions on regulated data. Needs your call on which row is
canonical.

---

## Task 6 — add 'coa' to the claim validator — **STOPPED, change NOT made**

### Premise corrections

1. The filter is `['research_paper', 'coffee_book']`, not
   `['brand','research','coffee_book']`.
2. **There is no comment explaining the exclusion.** The only comment restates
   the behaviour (`// 1) retrieve evidence — research_paper + coffee_book
   only.`). `git log` on the file shows a single commit, so no rationale was
   ever recorded anywhere.

Since the instruction was conditional on a documented reason and none exists, I
tested empirically instead of assuming the exclusion was an oversight. It is
not safe to remove yet.

### Evidence — health claim

Draft: *"PROTECT delivers higher chlorogenic acids because we roast lighter,
which supports cardiovascular health."*

```
['research_paper','coffee_book']          ['research_paper','coffee_book','coa']
0.742 [research_paper] Coffee Guide...    0.752 [coa] Coffee Guide..._V1-IR-EDITS
0.740 [research_paper] Coffee Guide...    0.752 [coa] Coffee Guide..._V1-IR-EDITS (1)
0.735 [research_paper] Circular Health    0.751 [coa] Coffee Guide..._V6-578pages
0.726 [research_paper] Krol-2020 poly...  0.750 [coa] Coffee Guide..._V2-IR-EDITS
```

Adding `'coa'` displaced **8 of 8** research chunks. Not one is a lab report —
they are book-manuscript proofs misclassified as `kind='coa'`, and they
outrank genuine research on health queries because book prose about
coffee-and-health is semantically closer to a health claim than a table of
analyte values is. The auditor would have *less* evidence, not more.

### Evidence — lab claim

Draft: *"Our PROTECT blend tested below 2 ppb for ochratoxin A in the most
recent lot."*

```
0.711 [coa]            COA-2016-PurityFullScreen
0.710 [research_paper] Lifeboost Mycotoxin Test      <- COMPETITOR
0.709 [coa]            JAVA_BURN_COA                 <- COMPETITOR
0.709 [coa]            COA_Report_3750933-0
```

Real COA chunks are reachable here — the mechanism works. But the `coa` kind
also holds **competitors' lab reports** (Java Burn, Lifeboost). An auditor
citing those to support a claim about Purity coffee would attribute another
brand's lab result to a Purity product, in regulated health-claim copy. That is
a worse failure than having no lab data.

### Third concern — the evidence hierarchy

The auditor assigns `evidence_tier` 1..7, where 1 = pre-registered RCT and
7 = in vitro. A certificate of analysis is not on that scale. A COA showing
40 mg/g CGA is not evidence that CGA does anything physiological, but it is
exactly the kind of chunk a model may cite to satisfy "evidence_engaged" for a
health claim. Enabling `'coa'` without teaching the prompt that lab data is
composition evidence, never efficacy evidence, invites the category error the
auditor exists to prevent.

### What would have to be true to enable it

1. Clean the 365 orphaned `kind='coa'` sources (Task 7) — these include the
   misclassified book manuscripts that dominated test 1.
2. Separate competitor COAs from Purity COAs, e.g. a `sources.metadata.brand`
   filter or a distinct kind.
3. Extend the SYSTEM prompt so COA chunks are treated as composition evidence
   only, and never count toward `evidence_tier`.

Then re-run both probes above. Until then the exclusion is doing real work.

**Nothing committed for this task** beyond this log entry. `audit-claim.ts` is
unmodified.

---

## Task 7 — orphaned COA sources — **DRY RUN ONLY, nothing deleted**

### Correction to my earlier audit

I reported "365 of 505 embedded coa sources are orphaned". **That was wrong.**
I computed the join with `path.replace('coa:','')`, which turns a `null` path
into `''` and counted every null-path source as an orphan. Correct breakdown:

```
860  kind='coa' sources
495  resolve to a live coas row     (written by embed-coas, path='coa:<uuid>')
 57  TRUE orphans                   (path set, coas row deleted)
308  path = null                    (a different pipeline; NOT orphans)
```

Retrieval exposure from true orphans is **57 chunks**, not thousands. The
earlier figure overstated it by ~6x. The artifact published earlier tonight
carries the wrong number.

### What the 308 null-path sources actually are

All 308 have a `drive_file_id`; 299 were created on 2026-05-05. They come from
`lib/sync.ts` — the Vercel-cron Drive ingestion — which labels everything in
the COA Drive folder `kind='coa'` without classifying it. **All 12 copies of
"The Coffee Guide to Better Health" manuscript are in this group.** That is the
same misclassified book text that displaced all 8 research chunks in Task 6.

So the two problems are distinct, and this matters for sequencing:

- Cleaning the 57 orphans does **not** remove the book manuscripts.
- The retrieval pollution blocking Task 6 lives in the 308, not the orphans.

Root cause is the two-parallel-pipelines finding from the audit:
`pull-new-coas.py` classifies and quarantines non-COAs into `_NotCOA/`, while
`lib/sync.ts` ingests the same Drive folder with no classification at all and
blanket-labels the contents `kind='coa'`.

### Script

`dashboard/app/scripts/clean-orphan-coa-sources.ts`, left ready for your
approval. Not wired into any workflow or npm script.

- Dry run is the default.
- Deleting needs **both** `--delete` and `--yes-i-am-sure`; either alone exits 2.
- It **retires rather than destroys**: stamps `sources.valid_until` and removes
  the dependent chunks, so retrieval stops surfacing them while provenance
  survives. Nothing is hard-deleted from `sources`.
- Reversible: clear `valid_until` and re-run `npm run embed-coas`.
- Null/malformed paths are reported separately and explicitly **left alone**,
  since they are not orphans.

### Dry-run output

```
kind='coa' sources      : 860
  resolve to a coas row : 495
  ORPHANED              : 57
    still active        : 57   <- retrievable today
    already retired     : 0
  malformed path        : 308
chunks on active orphans: 57
```

Sample of 10 active orphans:

```
222d2019  2026-04-26  Coffee COA Report 371593d3-87e9-4a76-a76b-bd7ca88ebc49
b90110dc  2026-04-26  Coffee COA Report c149ac23-519e-4dd4-909f-d87841b983c0
bfa75435  2026-04-26  Coffee COA Report 072934f0-a50a-4f7f-83ee-dc429db93d1d
eb45a943  2026-04-26  Coffee COA Report 3c7db963-9f6b-48cb-bab8-680daa13d565
9f93e9fa  2026-04-26  FTO SWP Mexico- NKG.coffee (Interamerican) Report c0d670cc
465cbeb8  2026-04-26  Roasted coffee, ground- Aponte Dark Roast Report 96dc9e3d
8c9b2fbf  2026-04-26  CALM Report a62e26ba-0aef-47d6-9009-3bac230e81fb
c0491b20  2026-04-26  "s as provided by client. This report may not be distributed..."
3ab33417  2026-04-26  Coffee COA Report 6fe4856d-24b3-4cb2-80d8-61efec95d49e
90f926cf  2026-04-26  Coffee COA Report fbe9a43c-9605-4b24-8454-08c07675cbf3
```

All 57 were created 2026-04-26, suggesting one early embed run against a COA
set that was later replaced. Note `c0491b20`, whose title is a fragment of lab
boilerplate ("...as provided by client. This report may not be distributed") —
a parser failure that captured disclaimer text as a title.

**STOPPED as instructed. Nothing deleted.**

---

# Task 8 — Final summary

## Fixed and verified

| # | Task | Result |
|---|---|---|
| 1 | LOQ rendering on support page + CSV | **PASS** — below-LOQ now "Not detected (<X)", three distinct states |
| 2 | Limit evaluation on support page | **PASS** — from `coa_limits` only; no-limit analytes never show a pass |
| 3 | `embed-coas` on the 6h schedule | **PASS** — 265/265 embedded (was 140), newest chunk == newest row |
| 4 | Reva SKILL path | **PASS** — 21,468 bytes load, all 3 modes non-empty (were 0) |
| 5 | BLEND_KEYS | **PASS** — blend-null 233/265 -> 224/266; BALANCE + ALZ recovered |
| — | LOQ in embedded COA text (extra) | Done — chat no longer reads "OTA: 1 ppb" for clean coffee |
| 6 | `'coa'` in claim validator | **STOPPED** — not made; evidence says exclusion is doing real work |
| 7 | Orphan cleanup | **DRY RUN ONLY** — 57 orphans found, nothing deleted |

Every task committed separately. `audit-claim.ts` untouched.

---

## Is /reports/support safe for a customer service team to read lab values from?

**No. It is substantially safer than it was this morning, but it is not safe,
and one defect is disqualifying on its own.**

### The disqualifying one: competitor products are displayed as ours

Three rows in `coas` are **other brands' coffee**, and all three group onto the
support page indistinguishably from Purity products:

```
CHG-42436434-0   19-905 / Lifeboost Meium Ground   COA-7-Jun-19-42436434-0.pdf
3481081-0        21-357                            BULLETPROOF_DECAF_COA.pdf
3481080-0        21-137                            BULLETPROOF_MED_COA.pdf
```

Two render as "21-357" and "21-137" — internal sample codes that give a rep no
clue they are Bulletproof. A rep asked "what's the mycotoxin level in your
decaf?" can land on `21-357`, read Bulletproof's numbers, and state them as
Purity's. Nothing on the page distinguishes them. This is a direct route from
the database to a false statement about our product, and no amount of LOQ
formatting fixes it.

**Until competitor COAs are excluded from that page, do not point a CS team at
it.** The narrow fix is a `coas.is_purity` / `brand` column set at import,
defaulting to false for anything not matched to a Purity product, with the
support page filtering on it.

### What I fixed, and what that does and does not buy you

Fixed: a below-LOQ contaminant no longer reads as a measured value; "not
tested" is no longer a dash that reads as zero; over-limit results are flagged;
analytes with no threshold say so rather than implying a pass. Those were the
worst *rendering* defects and they are genuinely closed.

Not fixed, still able to mislead:

1. **Competitor products** — above. Highest severity.
2. **Duplicate rows, growing every 6 hours.** `49608.pdf` has 5 rows and gains
   one per sync (Task 5 log for the mechanism). Rows with a null
   `report_number` are affected; 10 rows are exposed. Which duplicate a
   grouped cell draws from is arbitrary.
3. **Cells in one row can come from different COAs and different years.** The
   "latest test" date is the max across cells, not the date of any particular
   value. A rep reading across a row may quote a 2021 OTA result and a 2026
   CGA result as one product snapshot. The hover shows each cell's real date,
   but the row reads as a unit.
4. **The aflatoxin total in the database is still fabricated** — four
   non-detections summed to 2.0 ppb. Display is now safe because all such
   records have a qualifier (I verified: **0** records mix detected and
   non-detected components, so none slip through). But the wrong number is
   still what any other consumer sees: chat retrieval, the API, a future
   export, a BI tool.
5. **`coa_limits` fails silently to hardcoded defaults.** `loadLimits()` falls
   back to `DEFAULT_LIMITS` on error *or* when the table returns zero active
   rows, with no logging and no UI signal. If the service-role key is missing
   or an admin deactivates every limit, the compliance badges I added keep
   rendering — sourced from code, not from the table the admin is editing. A
   compliance indicator that cannot tell you it is running on stale defaults is
   a hazard.
6. **No in-page auth or role gate.** `/reports/support` makes no
   `auth.getUser()` call; it relies entirely on middleware and RLS. Any
   authenticated user of any role sees it.
7. **Three lots are over the OTA ceiling and nothing alerts.** The badge is
   passive. `CHG-50217971-0` at 7.3 ppb, `CHG-50217970-0` at 6.0,
   `CHG-50217786-0` at 3.9, against a 2 ppb ceiling.

### Minimum before handing it to a CS team

1. Exclude non-Purity COAs from the page (blocker).
2. Stop the duplicate-row growth.
3. Show each cell's date inline rather than on hover, or scope a row to one report.
4. Make the `coa_limits` fallback loud.

---

## Things you did not ask about

**Wrong lab values reaching a customer**

- **Competitor COAs in `coas`** — above. Also present in `sources`/`chunks` as
  `kind='coa'` (`JAVA_BURN_COA`, `Lifeboost Mycotoxin Test`), so chat can
  retrieve them for a Purity question. This is the same defect on two surfaces.
- **`lib/sync.ts` labels the whole COA Drive folder `kind='coa'`** with no
  classification, which is how 12 copies of the book manuscript became "COAs".
  `pull-new-coas.py` does classify and quarantine; the TypeScript pipeline does
  not. Two pipelines, one folder, different rules.
- **Heavy metals rendered null as "not detected"** in embedded text — fixed
  tonight, but it had been asserting negative results that were never obtained.

**Other**

- `import-coas` still does not consult `coa_mapping_rules`, so every 6-hour
  sync can overwrite origins the rules were meant to correct.
- `/reports` caps at 500 rows while its facet counts query 2000, so "All (N)"
  can exceed what is rendered.
- 61 records fall below the CGA floor of 40 mg/g. Possibly a green-vs-roasted
  mismatch in the threshold rather than 61 failing lots — worth checking before
  anyone reads that badge as a quality signal.
- `scripts/embed-canon.ts` is referenced by `package.json` but does not exist;
  `npm run embed-canon` is broken.
- The two migration ledgers (`migrations/` vs
  `dashboard/app/supabase/migrations/`) both have a `0001` and cannot see each
  other. CLAUDE.md documents only the second.

**Correction to my own earlier work:** the audit artifact published earlier
tonight says "365 orphaned COA sources". The real figure is **57**. See Task 7.
The artifact has not been regenerated.
