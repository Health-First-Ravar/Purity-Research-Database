# Purity Coffee Lab Intelligence System — Handoff Brief

**Project:** Purity Coffee Lab Intelligence Skill
**Status:** Architecture complete, grilling done, ready to build
**Full spec:** purity-lab-intelligence-architecture.md (same folder)
**One change from spec:** Product name mapping (product-map.json) is built AFTER initial build progress — not before. Start with an empty map and flag everything UNRESOLVED. The owner will populate it once the system is running.

---

## What You're Building

A Claude skill + Google Drive backend that lets customer service reps ask questions about Purity Coffee lab data and get fast, sourced answers. Internal analysts can also pull dashboards and trend views. The system maintains itself as new COAs are dropped into Drive.

---

## Five Things Myco Caught Before Handoff

These were surfaced by an adversarial review of the architecture after the main grilling. Three are build requirements. One needs an owner decision before you hit it.

**1. Concurrent log writes.** Multiple CS reps use the skill simultaneously. Google Drive has no write locking. If two sessions log an answer at the same second, you get duplicate entries and the deduplication logic breaks. Fix: Q&A log is append-only. Deduplication runs at read time, not write time. Never attempt to lock or merge at write time.

**2. Bootstrap procedure.** The first run ingests every existing COA in the library. This must be run as a standalone batch job before the skill goes live — not triggered by a CS rep opening the skill. If you rely on the on-open check to process a large initial library, it will time out mid-session. Run ingestion as a one-time bootstrap script, verify the index is complete, then activate the skill.

**3. Staleness detection.** If the scheduled task fails silently (Drive API timeout, malformed PDF, network drop), index.json doesn't update. The skill sees no new files and answers from stale data without warning. Required: the scheduled task writes a `last_successful_sync` timestamp to index.json on every successful run. The skill checks this on open. If it is more than 36 hours old, it surfaces a warning before answering: *"Note: data sync may be delayed. Last confirmed sync: [date]."*

**4. "Blend possibility" — owner decision needed before build.**
The owner mentioned wanting the system to answer questions about "a blend list or even a blend possibility." This was not fully resolved. Two options:
- **Refusal (current architecture):** If no COA exists for a blend, the system says "no test data available." Clean, safe, no extrapolation risk.
- **Extrapolation:** System estimates blend-level values from component data, clearly labeled as estimated. Requires a separate confidence tier and explicit "estimated from components — not a tested value" label.

The architecture currently specifies refusal. If extrapolation is wanted, tell the builder before Phase 2 — it changes the confidence system and answer templates.

---

## The Four Things That Will Break It If You Get Them Wrong

**1. Retest handling.** COA reports sometimes contain multiple readings for the same analyte (initial test + retests). Always use the LAST retest value. Never surface the initial value to users. Store it for audit only.
Example from data: Purity PROTECT 2022 — Lead: 36.3 → 20.4 → 14.8 → 10.6 ppb. Answer is 10.6.

**2. Superseded reports.** Some COAs have a "Supercedes: [report number]" field. When ingesting a superseding report, locate the older report in the index and mark it VOID. VOID reports are never used in answers. Keep them for audit trail only.
Example from data: Report 3608933-0 supersedes 3598471-0.

**3. Unit normalization.** Chlorogenic acids appear in both mg/100g and mcg/g across reports. Heavy metals appear in both ppb and ppm. Normalize on ingestion: chlorogenic acids → mg/100g, heavy metals → ppb. Store original unit alongside normalized value.

**4. Data hierarchy.** Blend-level COAs (PROTECT, EASE, FLOW, CALM) are Tier 1 — always answer customer questions from these first. Component/single-origin COAs (Brazil La Floresta, Peru SW Decaf, etc.) are Tier 2 — used only for component-specific questions or when they conflict with blend data. Never lead with component data for a customer answer.

---

## What's Confirmed

**Architecture:** Claude skill + Google Drive. Scheduled task syncs 2x/day. Skill checks for new files on open and ingests before answering if new data found.

**Users:**
- Customer service reps: Q&A only, no data write access
- Internal analysts: can add COAs to Drive, can request dashboards

**File formats:** Primarily PDFs (Eurofins COAs). Occasional DOCX. All from same lab network (Eurofins sub-locations). Different reports have different test panels — this is normal, not an error.

**Confidence routing:**
- ≥80% confident → answer directly with source citation
- 60–80% → answer with caveat, offer ticket
- <60% → soft answer, recommend ticket

**Missing test panel response (soft, not alarming):**
"[Product] hasn't been specifically tested for [analyte]. Across our product line, [general pattern]. Our practices [brief if available]. Happy to connect you with our education team for more detail."

**Sensitive findings (e.g., acrylamide at 197 mcg/kg in PROTECT 2022):**
Answer directly, apply to all relevant products, offer education team follow-up email. Don't hide the number — it's below FDA reference levels and general coffee industry context is available.

**Batch dating:** Always use test date (Date Started field), not file add date.

**Source labeling:** Every answer must end with one of:
- `[Source: Lab data — Report XXXXXXX, tested MM/DD/YYYY]`
- `[Source: Purity company documentation]`
- `[Source: General coffee industry knowledge — not Purity-specific test data]`

**Q&A log behavior:** Log every question + answer + data snapshot. On repeated question, check if underlying data changed. If yes: serve updated answer + note the change ("Historical result was X; current result is Y").

**Product mapping timing:** Build the system first. product-map.json starts empty. Unresolvable sample IDs are flagged UNRESOLVED in the index. Owner populates the map after seeing which IDs are in the library.

---

## Drive Folder Structure to Create

```
/Purity-Lab-Data/
  /COAs/              ← owner drops raw lab reports here (PDF, DOCX)
  /Processed/         ← system writes normalized JSON per report here
  /logs/              ← Q&A log
  /synthesis/         ← one synthesis doc per product
  /index.json         ← master file index
  /product-map.json   ← sample code → product name (starts empty)
  /knowledge-base/    ← brand docs, SOPs (Phase 5, not needed now)
```

---

## Build Sequence

**Phase 1 — Ingestion foundation**
- PDF/DOCX extraction
- Structured JSON output per report (report number, date, sample name, lot, all analytes + results + units)
- Unit normalization
- Retest rule (last value wins)
- Superseded report handling (VOID marking)
- Product-map lookup with UNRESOLVED flagging
- index.json writer

**Phase 2 — Core skill**
- Skill Q&A interface reading from processed JSONs
- Q&A log writer (/logs/)
- Source labeling on every answer
- Confidence scoring + ticket routing

**Phase 3 — Intelligence layer**
- Synthesis log builder/updater (/synthesis/)
- Scheduled task (2x daily ingestion)
- STALE answer detection (check log against new data)
- Skill checks for new files on open

**Phase 4 — Dashboard**
- Internal analyst view: cross-product analyte comparison table
- Time-series per analyte per product
- Test coverage gap report (which products haven't been tested for what)

**Phase 5 — Knowledge base**
- Add brand docs to /knowledge-base/ as owner provides them
- Skill cites them with correct source label

---

## Sample Documents Available

Seven actual Purity Coffee COAs are in the project uploads. They cover:
- Brazil La Floresta (component, 2021) — heavy metals, mycotoxins, moisture, water activity, gluten
- PSS Primavera (component, 2020) — full panel including pesticides, chlorogenic acids
- Peru SW Decaf (component, DOCX, 2021) — mycotoxins only
- 21-358 (component, 2021) — chlorogenic acids, heavy metals, PAHs
- Purity PROTECT 2022 — nutrients + chlorogenic acids (per serving) + heavy metals + pesticides + acrylamide + mycotoxins + yeast/mold
- Purity EASE 2022 — same nutritional panel as PROTECT
- Purity FLOW 2022 — same
- Purity CALM 2022 — same

Use these as test data for the ingestion pipeline.

---

## Open Items (Owner to provide, no rush)

1. Google Drive folder path/ID where COAs currently live
2. Education team email address for the follow-up trigger
3. Product name → sample code mappings once system is running (product-map.json)
4. Brand documents for knowledge-base (Phase 5, not blocking)

---

## What Good Looks Like on First Ship (Phase 2 complete)

A CS rep opens the skill, asks "does PROTECT have pesticides?", and gets:
*"Based on our March 2022 testing (Report 3608933-0), Purity PROTECT was screened for 500+ pesticide compounds via GC-MS/MS and LC-MS/MS. No pesticides were detected at the limit of quantification. [Source: Lab data — Report 3608933-0, tested 01-Mar-2022]"*

That answer is accurate, sourced, dated, and requires zero human lookup time.
