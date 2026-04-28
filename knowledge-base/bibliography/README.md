# Bibliography — Coffee Research Catalog (448 articles)

Source: `Coffee_Research_Bibliography_448_Articles_COMPLETE.xlsx` — Jeremy's
curated catalog of coffee-health primary literature, organized by Drive
location (medical topic) with per-row DOI, year, topic/category, database,
and rights flags.

## Shape

| Column                                   | Use                                                     |
|------------------------------------------|---------------------------------------------------------|
| Name of Article                          | → `sources.title`                                       |
| Year Published                           | → `sources.year_published` (int)                        |
| DOI                                      | → `sources.doi` (unique index on active rows)           |
| Topic/Category                           | → `sources.topic_category` (fine-grained)               |
| Where it can be found (Drive Location)   | → `sources.drive_location` (high-level topic)           |
| Where it can be found (Database/Platform)| → `sources.database_platform`                           |
| Is it free to share?                     | → `sources.rights_share`                                |
| Is it free to download?                  | → `sources.rights_download`                             |

## Distribution (from this xlsx)

- **Total rows**: 492; **with title**: 458; **with DOI**: 447
- **Year range**: 1983 – 2025
- **Drive Location** (high-level topic) — the primary filter on the UI:
  - Related Articles (207), Cancer (60), Cardiovascular disease (52),
    Type II Diabetes (31), Gastrointestinal diseases (22), Longevity (20),
    Performance Enhancement (18), Alzheimer's (15), Parkinson's (8),
    Depression (7), Obesity (7), Mental Health (1)
- **Rights — shareable**: 101 "Yes" + 67 "CC BY" + 1 "CC BY 3.0" = 169 shareable
- **Rights — downloadable free**: 69 OA + 69 PMC + 34 Free access = **172 open-access PDFs**

## Pipeline

```bash
# 1. Run schema migration 0002_bibliography.sql in Supabase
# 2. Import the xlsx (idempotent on DOI)
cd dashboard/app
npm run import-bibliography
# 3. (Follow-up) batch-download the 172 open-access PDFs via DOI → PMC resolution
#    then re-ingest to embed them into chunks.
```

## Status

- [x] xlsx copied here for traceability
- [x] Schema migration 0002 adds doi/year/topic_category/drive_location/rights_* columns
- [x] `scripts/import-bibliography.ts` upserts by DOI (fallback: title+year)
- [x] Bibliography page uses `bibliography_view`, filters by topic / rights / year / PDF
- [ ] **Open-access PDF download pipeline** — resolve DOI → PMC OA → pdftotext → embed
- [ ] **Deduplicate against existing `research/` 34-paper corpus** — many of the 34 should
      DOI-match into these 448 rows; post-import pass flags overlaps and merges the
      chapter tag from `sources.chapter` with the new `topic_category`.

## Overlap with existing `research/` corpus

The 34 papers in `../research/by-chapter/` are already chunked and embedded.
Those are organized by CHC book chapter (01–18), which is a different cut than
the xlsx's drive_location. After import:

- DOI match → merge: keep the chunked research row, backfill
  `doi`/`topic_category`/`drive_location`/`rights_*` from the xlsx
- No DOI match → treat as xlsx-only (catalog-only; no chunks until PDF pulled)

The import script handles the merge path automatically via the DOI unique index.
