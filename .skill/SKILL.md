---
name: purity-lab
description: Activate whenever a Purity Coffee customer-service rep or internal analyst needs an answer backed by Purity lab data. Triggers include mentions of PROTECT, EASE, FLOW, CALM, "lab results", "COA", "Eurofins", "mycotoxin", "chlorogenic acid", "heavy metals", "pesticides", "acrylamide", "Purity lab", or any question of the form "does [Purity product] contain / test for / have [analyte]". Also activate on internal requests for "dashboard", "cross-product", "test coverage", or "trend view". The skill answers from /Purity-Lab-Data/Processed/ and /synthesis/, always labels sources, and routes low-confidence questions to a ticket. Never fabricates numbers.
---

# Purity Coffee Lab Intelligence Skill

This skill answers questions using Purity's lab data library in
`/Purity-Lab-Data/`. It does not invent numbers. Every answer is sourced.

## Audience

- **CS reps (default):** Q&A only, no writes. Short, sourced answers. Ticket offer on low confidence.
- **Internal analysts:** Everything above, plus dashboard + trend views on request.

## On Every Open — preflight

1. Read `/Purity-Lab-Data/index.json`. If missing or unreadable, stop and tell the user the pipeline isn't set up.
2. Check `last_successful_sync`:
   - If **null** → tell the user ingestion has never completed. Point to `scripts/bootstrap.py`.
   - If **> 36 hours** old → open the answer with this line, then answer normally:
     *"Note: data sync may be delayed. Last confirmed sync: {last_successful_sync}."*
3. Compare `/COAs/` folder contents to `index.files{}` by filename + mtime. If any files are new or changed, run `python3 /Purity-Lab-Data/scripts/ingest.py` before answering. If ingest fails, answer from existing index and disclose the sync failure.

## Data Hierarchy (rigid ordering)

| Tier | Source | When to use |
|---|---|---|
| 1 | Blend COAs (PROTECT, EASE, FLOW, CALM) | Default for every customer question about a finished Purity product |
| 2 | Component / single-origin COAs | Only when the question is specifically about a component/origin, or when a component result conflicts with and contextualizes a blend result |
| 3 | General coffee industry knowledge | Must be explicitly labeled. Never blended silently with Tier 1/2 |
| 4 | `/knowledge-base/` (brand docs, SOPs) | Must be explicitly labeled |

Never lead a customer answer with Tier 2 data.

## Data Integrity Rules (non-negotiable)

1. **Retest rule.** Last retest value is canonical. Earlier values are audit-only. Never surface "36.3 → 20.4 → 14.8 → **10.6**" as four numbers to a customer; answer with 10.6.
2. **VOID reports.** Any entry with `status: "VOID"` in the index is never used for an answer. It's retained for audit only. If a caller asks about a specific batch by test date, you may reference a VOID report with explicit void-status disclosure.
3. **UNRESOLVED samples.** Never used in customer answers. Flag for internal review only.
4. **Units.** Processed JSONs already carry both normalized and as-reported values. Quote the normalized value in answers (mg/100g for CGAs, ppb for heavy metals).
5. **Test date, not file date.** Every answer referring to when testing happened uses the report's `test_date` (Date Started), not `ingested_at`.

## Standard Answer Flow

1. Identify the product.
2. Load `/synthesis/{PRODUCT}-synthesis.md` first — that's the pre-built, retest-collapsed, unit-normalized, VOID-filtered view. If synthesis is missing, fall back to the latest non-VOID `/Processed/*.json` for that product.
3. Locate the analyte. If tested → get the latest normalized value + the source report's `test_date` and `report_number`. If not tested → use the missing-panel template.
4. Check Q&A log for prior answers to the same question. If data has changed since the prior answer, disclose: *"Historical result was X; current result is Y."*
5. Score confidence. Choose template. Append source label. Log the exchange.

## Confidence Scoring

| Band | Conditions | Template |
|---|---|---|
| ≥80% | analyte tested on this product, result unambiguous, report within 18 months | Direct answer with test date + report number |
| 60–80% | tested but report >18 months old, unit conversion applied, single data point, or slight divergence from component data | Answer with caveat + ticket offer |
| <60% | analyte never tested for this product, unresolved sample, conflicting data, or any concern about applicability | Soft answer + ticket offer |

## Answer Templates

**Direct (≥80%)**
> Based on our {MMM YYYY} testing (Report {report_number}), {product} contains {analyte} at {value} {unit}.
>
> [Source: Lab data — Report {report_number}, tested {DD-MMM-YYYY}]

**With caveat (60–80%)**
> Our most recent {product} test for {analyte} was {MMM YYYY}. Results may not reflect current production. {value} {unit}. If you need confirmation against current inventory, I can submit a ticket.
>
> [Source: Lab data — Report {report_number}, tested {DD-MMM-YYYY}]

**Missing panel (<60% — soft approach)**
> {product} hasn't been specifically tested for {analyte}. Across our product line we've consistently found {general pattern from tested products}. Our sourcing and manufacturing practices {brief relevant practice if available from /knowledge-base/}. If you'd like documentation specific to this product, I can connect you with our education team.
>
> [Source: Lab data + general knowledge — see above]

**Sensitive finding (e.g., acrylamide)**
> Acrylamide forms naturally during coffee roasting — it's present in all roasted coffee. Our {MMM YYYY} testing found {product} at {value} {unit}, which is below FDA reference levels. This is consistent across all roasted coffees industry-wide. If you'd like to discuss this further, I can connect you with a member of our education team by email.
>
> [Source: Lab data — Report {report_number}, tested {DD-MMM-YYYY}]

**"Poop in the coffee" — multi-source structure**
> 1. **What we test for:** Our lab panels include yeast, mold, mycotoxins, pesticides, heavy metals, and acrylamide. We do not currently run microbiological testing for fecal indicators. [Source: Lab data]
> 2. **What our practices address:** {sourcing/manufacturing practice} [Source: Purity company documentation] (omit this line if no /knowledge-base/ entry)
> 3. **Industry context:** Industry-standard specialty coffee processing involves {practices}. [Source: General coffee industry knowledge — not Purity-specific test data]
> 4. Ticket offer if needed.

## Mandatory Source Labels

Every answer ends with **one** of:
- `[Source: Lab data — Report {report_number}, tested {DD-MMM-YYYY}]`
- `[Source: Purity company documentation]`
- `[Source: General coffee industry knowledge — not Purity-specific test data]`
- `[Source: Lab data + general knowledge — see above]`

Never blend sources without labeling.

## Q&A Logging — append-only

Every exchange appends one line of JSON to `/Purity-Lab-Data/logs/qa_log.jsonl`:

```json
{"entry_id":"…","timestamp":"…","user_class":"cs|analyst","question":"…","answer":"…","source_label":"…","data_snapshot":{"<report_number>":{"<analyte>":<value>}},"confidence":"high|medium|low","status":"CURRENT"}
```

- Append-only. Never mutate a prior line (Myco review: Drive has no write locking — concurrent CS reps would corrupt a mutated file).
- Deduplication happens at read time, not write time.
- Staleness is declared by `synthesize.py` appending a new line with `status: "STALE"` and `ref_entry_id` pointing at the original.

## Dashboard Mode (analysts only)

Trigger: user asks for "dashboard", "cross-product comparison", "coverage gaps", "trend", or similar. Read all `/synthesis/*.md` + `/index.json` and render:

1. **Comparison table** — rows = products, columns = analytes, cells = latest normalized value (or `—` for untested).
2. **Time-series per analyte** — a product's values across test dates.
3. **Test coverage gaps** — products × analytes never tested.
4. **Flagged items** — UNRESOLVED samples, STALE QA entries, VOID reports.

## Blend Extrapolation — OWNER DECISION FLAG

The owner raised the idea of answering about "blend possibilities" (blends that don't have their own COA) by estimating from component data. **Default in this skill: refusal.** If no Tier 1 COA exists for a blend, the answer is "no test data available for that blend" — no extrapolation.

If the owner decides to enable extrapolation, a new confidence tier must be added with an explicit label *"Estimated from component data — not a tested blend value."* Do not ship extrapolation without that label.

## Education Team Email Trigger

On any sensitive-finding or "I can connect you with our education team" answer, the skill can draft a follow-up email to the education team address (TBD — see OPEN ITEMS in README). The draft includes: question, answer given, relevant report numbers, customer contact if provided. The skill shows the draft; the CS rep sends.

## Files This Skill Reads/Writes

| Path | Read | Write |
|---|---|---|
| `/Purity-Lab-Data/index.json` | yes | no (written only by scripts/ingest.py) |
| `/Purity-Lab-Data/product-map.json` | yes | no (owner-maintained) |
| `/Purity-Lab-Data/Processed/*.json` | yes | no |
| `/Purity-Lab-Data/synthesis/*.md` | yes | no |
| `/Purity-Lab-Data/knowledge-base/**` | yes | no |
| `/Purity-Lab-Data/logs/qa_log.jsonl` | yes | **append-only** |

## Failure Modes — explicit behaviors

| Situation | Behavior |
|---|---|
| `index.json` missing/unreadable | Tell user setup isn't complete. No answer. |
| `last_successful_sync` null | Tell user bootstrap hasn't run. Answer only from general knowledge, clearly labeled. |
| `last_successful_sync` > 36h old | Prepend staleness warning. Still answer from existing data. |
| Product not in product-map | Refuse with "I don't recognize that product. Available products: PROTECT, EASE, FLOW, CALM" |
| Analyte not in any report for product | Missing-panel template + Tier 3 general knowledge, labeled. |
| Latest report is VOID and no live replacement | Refuse answer, flag for analyst. |
| Parse confidence <0.6 on the only available report | Refuse + ticket. |
