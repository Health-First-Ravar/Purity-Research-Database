# Purity Coffee — Lab Intelligence System

Claude skill + structured library that lets customer service reps ask questions about Purity Coffee lab data and get fast, sourced answers. Internal analysts pull dashboards and trend views. The system maintains itself as new COAs are dropped into `/COAs/`.

Architecture spec: `docs/purity-lab-intelligence-architecture.md`
Handoff brief: `docs/purity-lab-handoff.md` (includes Myco's adversarial review notes)

## Layout

```
Purity-Lab-Data/
├── COAs/                 ← drop raw lab reports here (PDF, DOCX)
├── Processed/            ← system-written normalized JSON, one per report
├── logs/
│   └── qa_log.jsonl      ← append-only Q&A log (created on first exchange)
├── synthesis/            ← one markdown synthesis doc per product
├── knowledge-base/       ← Tier 4 brand docs & SOPs (owner-populated)
├── scripts/
│   ├── ingest.py         ← PDF/DOCX → normalized JSON + index update
│   ├── synthesize.py     ← per-product synthesis markdown + STALE flagger
│   ├── bootstrap.py      ← one-time batch ingestion of existing library
│   ├── sync.py           ← 2x-daily scheduled pass
│   ├── lib_extract.py    ← Eurofins PDF / DOCX extraction + retest collapse
│   └── lib_units.py      ← unit normalization (CGAs→mg/100g, metals→ppb)
├── .skill/SKILL.md       ← the Claude skill itself
├── index.json            ← master file index (system-maintained)
├── product-map.json      ← sample code → product lookup (owner-maintained)
└── README.md             ← this file
```

## Setup — one-time

```bash
pip install pdfplumber python-docx --break-system-packages
```

## Usage

**Drop COAs:** put PDFs (and the occasional DOCX) into `/COAs/`. Nothing else.

**First-time bootstrap** (run once before exposing the skill to CS reps):

```bash
cd Purity-Lab-Data/scripts
python3 bootstrap.py
```

Review the summary. Any samples listed as `UNRESOLVED` need to be mapped in `product-map.json` before the skill can answer about them. Any `LOW_CONFIDENCE` parses need a manual look — check `source_file` in `Processed/<report>.json`.

**Ongoing sync** (wire into a scheduled task, 2× daily):

```bash
python3 Purity-Lab-Data/scripts/sync.py
```

**Ad-hoc re-ingest** of a single file:

```bash
python3 Purity-Lab-Data/scripts/ingest.py --file 'Purity PROTECT 2022.pdf'
```

## Invariants (do not break)

1. **Retest:** last value wins. Prior values live only in `parse_notes` as audit trail.
2. **VOID:** any report whose number appears in another report's "Supercedes" field is marked VOID. VOID reports are never used for answers.
3. **Units:** chlorogenic acids → mg/100g, heavy metals → ppb. Original unit preserved alongside.
4. **Test date, not file date.** Everything keys on `test_date` (Date Started field).
5. **Append-only logs.** Never mutate `qa_log.jsonl`. Staleness is declared by appending a new line.
6. **last_successful_sync stamped only on clean runs.** If a sync fails silently the timestamp doesn't advance, and the skill surfaces a staleness warning after 36h.

## Open Items (owner to provide, no rush)

1. Education-team email address for follow-up triggers.
2. `product-map.json` seed mappings (sample code / lot / PO → product key) — to be populated after bootstrap surfaces the unresolved list.
3. Knowledge-base documents for `/knowledge-base/` (SOPs, sourcing standards, certifications).
4. Decision on **blend extrapolation**: default is refusal (no COA → no answer). If extrapolation is wanted, add the "Estimated from components — not a tested value" confidence tier before Phase 2 goes live.

## Phase Status

- [x] Phase 1 — Ingestion foundation (retest, supersede, unit normalization, UNRESOLVED flagging, index writer)
- [x] Phase 2 — Core skill (Q&A, source labeling, confidence routing, Q&A log append, staleness warning)
- [x] Phase 3 — Intelligence layer (synthesis builder, STALE detection, scheduled sync)
- [ ] Phase 4 — Dashboard (cross-product comparison, coverage gaps) — skeleton in SKILL.md, no generator script yet
- [ ] Phase 5 — Knowledge base (add brand docs to `/knowledge-base/`)
