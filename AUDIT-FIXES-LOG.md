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
