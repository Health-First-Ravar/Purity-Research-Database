# Purity Coffee — Lab Intelligence System
## Architecture Specification

---

## What This System Is

A Claude skill backed by Google Drive that gives customer service reps fast, accurate answers to product questions, gives internal analysts a dashboard view across all lab data, and maintains itself as new COAs are added to the Drive folder. It synthesizes data across all lab reports as if they came from one source, tracks historical trends, flags when new data changes a previous answer, and clearly distinguishes between lab-verified data and general coffee knowledge.

---

## Users and What They Can Do

**Customer Service Reps (primary audience)**
- Ask questions about any Purity product and get fast, sourced answers
- Receive answers that clearly state whether data comes from lab tests, company documentation, or general coffee knowledge
- Trigger a follow-up email to the education team for questions needing deeper context
- Cannot add data or modify the system

**Internal Analysts / Data Managers**
- Add new COAs to the Drive folder (triggers ingestion on next sync or skill open)
- Request dashboard view: trends over time, cross-product comparisons, test coverage gaps
- View full historical data including superseded reports (audit trail)

---

## Data Architecture

### Google Drive Folder Structure

```
/Purity-Lab-Data/
  /COAs/                     ← all raw lab reports (PDF, DOCX)
  /Processed/                ← system-generated normalized JSON per report
  /logs/                     ← Q&A log (timestamped questions + answers)
  /synthesis/                ← running synthesis documents per product
  /index.json                ← master file index with ingestion timestamps
  /product-map.json          ← sample code → product name lookup table
  /knowledge-base/           ← brand docs, SOPs, sourcing practices (optional, add over time)
```

### Data Hierarchy

**Tier 1 — Blend COAs (primary source for customer questions)**
Named finished products: PROTECT, EASE, FLOW, CALM (and any future blends).
Tested as finished products, per serving size.
CS reps answer from Tier 1 first, always.

**Tier 2 — Component COAs (secondary source)**
Single-origin and raw material reports (Brazil La Floresta, Peru SW Decaf, PSS Primavera, etc.).
Used only when: (a) a question is specifically about a component/origin, or (b) a component result conflicts with or contextualizes a blend result.
Never surfaced to customers as the primary answer.

**Tier 3 — General Knowledge**
Claude's training knowledge about coffee chemistry, industry standards, FDA limits, manufacturing practices.
Always labeled explicitly: *"Based on general coffee industry knowledge, not Purity test data..."*

**Tier 4 — Brand Documents**
SOPs, sourcing practices, manufacturing certifications (add to /knowledge-base/ over time).
Always labeled explicitly: *"Based on Purity company documentation..."*

---

## Data Integrity Rules

### Rule 1 — Retest Handling
When a report contains both initial and retest values for the same analyte (e.g., Lead: 36.3 → 20.4 → 14.8 → 10.6 ppb), the system uses the **last retest value only** as the canonical result. Initial and intermediate values are stored internally for audit but never surfaced to users unless specifically requested. The system logs that retesting occurred.

### Rule 2 — Superseded Reports
Any COA containing a "Supercedes: [report number]" field triggers the following:
- The superseded report is located in the index and marked **VOID**
- VOID reports are never used as primary data sources
- VOID reports are retained in the archive for audit trail only
- Exception: if a user asks about a specific batch by test date (not add date), the system can reference the appropriate test-date report, including void status disclosure

### Rule 3 — Batch Dating
All data is associated with **test date** (Date Started field in the COA), not the date the file was added to Drive. When a customer asks about a specific batch or lot, the system uses test date to locate the relevant report. Reports added late do not retroactively change what was true on a manufacture date.

### Rule 4 — Unit Normalization
On ingestion, all values are normalized to a common basis:
- Chlorogenic acids → mg/100g (canonical unit)
- Heavy metals → ppb (canonical unit; ppm inputs converted ×1000)
- Serving-size values stored both as-reported and normalized per 100g
The original reported unit is always preserved alongside the normalized value.

### Rule 5 — Sample Identity
Each COA is mapped to a product name via product-map.json. If a sample code (e.g., "21-358", "PSS-P002593") cannot be resolved to a known product, the report is ingested and stored but **omitted from blend-level synthesis**. It is flagged in the index as UNRESOLVED and surfaced to internal analysts for manual mapping. Data that cannot be traced to a specific product is never used in customer answers.

### Rule 6 — Test Panel Gaps
Not every product has been tested for every analyte. When a question involves an untested analyte for a specific product, the system never fabricates a result. See Answer Strategy below.

---

## Ingestion and Sync

### On Skill Open (per-session check)
1. Fetch index.json from Drive
2. Compare Drive folder contents against index (file list + modification timestamps)
3. If new files detected: run ingestion pipeline before answering any questions
4. If no new files: proceed directly

### Scheduled Sync (2× daily)
Full ingestion pass:
1. Scan all COAs in /COAs/ folder
2. For each file not yet in processed index:
   - Extract structured data (report number, date, sample name, lot, all analytes + results + units)
   - Apply unit normalization
   - Check for "Supercedes" field → mark old report VOID if applicable
   - Apply retest rule → identify canonical value per analyte
   - Attempt product-map lookup → flag UNRESOLVED if no match
   - Write normalized JSON to /Processed/
   - Update index.json
3. Rebuild synthesis documents for any product with new data
4. Check synthesis against Q&A log → flag any logged answers that may have changed

### DOCX Handling
DOCX files are parsed with python-docx. Tables are extracted row by row. If extraction confidence is low (mangled table structure detected), the file is flagged in the index for manual review rather than silently ingested with bad data.

---

## Answer Strategy

### Standard Answer Flow
1. Identify the product being asked about
2. Locate most recent non-void Tier 1 COA for that product
3. Check if the question's analyte was tested → if yes, return canonical value
4. Check Q&A log for same or similar prior questions → note if answer has changed since last logged response
5. Compose answer with source citation and data currency

### Confidence System
**≥80% confidence** (analyte tested, clear result, recent report):
→ Answer directly. Include test date and report number.
*"Based on our March 2022 testing (Report 3608933-0), PROTECT contains lead at 10.6 ppb."*

**60–80% confidence** (analyte tested but report is older, or unit conversion applied, or single data point):
→ Answer with caveat. Flag data age or basis.
*"Our most recent test for this was [date]. Results may not reflect current production. [answer]. If you need confirmation against current inventory, we can submit a ticket."*

**<60% confidence** (analyte never tested for this product, or sample identity unresolved, or conflicting data):
→ Soft answer + ticket offer.
*"We don't have specific test data for [analyte] in [product]. Based on comparable products in our line... [general answer]. For a confirmed answer tied to this specific product, I can open a ticket with our quality team."*

### Missing Test Panel Response
Template (Fork 12 — Option B, soft approach):
*"[Product] hasn't been specifically tested for [analyte]. Across our product line, we've consistently found [general pattern from tested products]. Our sourcing and manufacturing practices [brief relevant practice if available from knowledge-base]. If you'd like documentation specific to this product, I can connect you with our education team."*

### Sensitive Findings (e.g., Acrylamide)
Answer directly using blend-level data. Apply to all relevant products if the finding is consistent across the line. Offer education team follow-up.

Example (Acrylamide):
*"Acrylamide forms naturally during coffee roasting — it's present in all roasted coffee. Our 2022 testing found PROTECT at 197 mcg/kg, which is below FDA reference levels. This is consistent across all roasted coffees industry-wide. If you'd like to discuss this further, I can connect you with a member of our education team by email."*

### Source Labeling (mandatory on every answer)
Every answer must end with one of:
- `[Source: Lab data — Report XXXXXXX, tested MM/DD/YYYY]`
- `[Source: Purity company documentation]`
- `[Source: General coffee industry knowledge — not Purity-specific test data]`
- `[Source: Lab data + general knowledge — see above]`

---

## Q&A Log (/logs/)

Each logged entry contains:
- Timestamp of question
- User identifier (internal vs. CS, anonymized)
- Question text (normalized)
- Answer given
- Source citation
- Data snapshot: report numbers and dates used to generate the answer
- Status: CURRENT or STALE (updated on each sync if underlying data changed)

On a repeated or similar question:
- System checks log for prior answers to the same question
- If prior answer exists and data is unchanged → confirm answer is still current, serve it
- If prior answer exists but data has changed → serve updated answer + note: *"Our most recent data [date] updates a previous answer. Historical result was [X]; current result is [Y]."*
- If no prior answer → generate fresh, log it

---

## Synthesis Log (/synthesis/)

One synthesis document per product (e.g., PROTECT-synthesis.md). Contains:
- Latest canonical values for all tested analytes
- Historical trend: all prior values by test date
- Test coverage map: which analytes have been tested, which have not
- Inter-report conflicts: cases where component data diverges from blend data
- Last updated timestamp

Updated on every ingestion pass that adds new data for that product.

---

## Dashboard (Internal Analysts)

On request, the skill generates a structured report containing:
- All products × all analytes: latest values in a comparison table
- Time-series view per analyte: how values have changed across test dates
- Test coverage gaps: products × analytes never tested
- Flagged items: UNRESOLVED sample IDs, STALE log entries, VOID reports

---

## Blend vs. Component Tracking

**Blend-level answer (default for all customer questions)**
Use Tier 1 COA. The blend has been tested as a finished product. This is the authoritative answer.

**Component-level escalation (when relevant)**
If a customer asks specifically about an origin ("is your Ethiopia single origin free of pesticides?") and a component COA exists, use that.
If a component result conflicts with the blend result (e.g., a raw material test shows elevated heavy metals but the finished blend test is clean), surface both with context: *"The finished product tested at [X]. An earlier raw material test showed [Y]. The finished product test is the most relevant to the coffee as you'd consume it."*

**Unresolvable components**
If a sample cannot be traced to a product → never use in customer answers. Flag for internal review.

---

## Knowledge Base Distinction (mandatory)

Every answer that draws on multiple sources must clearly delineate them. Never blend sources without labeling. The "poop in the coffee" rule:

**Question:** "Is there fecal contamination in your coffee?"
**Answer structure:**
1. What we test for: *"Our lab panels include yeast, mold, mycotoxins, pesticides, heavy metals, and acrylamide. We do not currently run microbiological testing for fecal indicators."* [Source: Lab data]
2. What our practices address: *"Our sourcing standards require [X] and our manufacturing process includes [Y]."* [Source: Company documentation — if available]
3. General knowledge bridge: *"Industry-standard specialty coffee processing involves [relevant practices]."* [Source: General knowledge]
4. Ticket offer if needed.

---

## Skill Components to Build

**1. Ingestion Script (Python, runs in Cowork sandbox)**
- Google Drive MCP → read files from /COAs/
- PDF text extraction (pdfplumber or pdfminer)
- DOCX extraction (python-docx)
- Structured JSON output per report
- Unit normalization
- Retest rule application
- Superseded report handling
- Product-map lookup + UNRESOLVED flagging
- Write to /Processed/ and update index.json

**2. Synthesis Builder**
- Reads all processed JSONs for a product
- Builds/updates synthesis document
- Flags Q&A log entries that have gone STALE

**3. Scheduled Task**
- Runs ingestion script 2× daily
- Triggers synthesis rebuild for updated products
- Logs run timestamp and file count to index.json

**4. Claude Skill (SKILL.md)**
- On open: check index for new files, trigger ingestion if needed
- Q&A interface: question → product ID → tier 1 lookup → answer
- Log writer: write Q&A entries to /logs/
- Dashboard generator: on internal request
- Source labeler: tag every answer with correct source type
- Confidence scorer: route to direct answer, caveat, or ticket
- Education team email trigger: generate draft follow-up email on request

---

## What Gets Built First (Recommended Sequence)

**Phase 1 — Foundation (build before anything else)**
1. product-map.json — you provide the product name → sample code/lot mappings you know; system flags the rest
2. Ingestion script with retest + superseded rules
3. index.json structure
4. Unit normalization layer

**Phase 2 — Core Skill**
5. Skill Q&A interface reading from processed JSONs
6. Q&A log writer
7. Source labeling
8. Confidence system + ticket routing

**Phase 3 — Intelligence Layer**
9. Synthesis log builder
10. Scheduled task (2× daily)
11. STALE answer detection

**Phase 4 — Dashboard**
12. Internal analyst dashboard view
13. Test coverage gap report

**Phase 5 — Knowledge Base**
14. Add brand documents to /knowledge-base/ as they become available
15. Skill reads and cites them when relevant

---

## Open Items Requiring Your Input Before Phase 1

1. **product-map.json seed data** — provide the product names and any known sample codes, lot numbers, or PO numbers you can map. The system will flag the rest as UNRESOLVED.
2. **Google Drive folder structure** — confirm the Drive folder path where COAs live and whether you want the system to create the /Processed/, /logs/, /synthesis/ subfolders.
3. **Education team email** — provide the email address or routing logic for the follow-up email trigger.
4. **Knowledge base documents** — identify which company documents (SOPs, sourcing standards, certifications) should be added to /knowledge-base/ in Phase 5.
