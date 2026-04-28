# Seed-scrape pipeline (Track 1)

Bootstraps `canon_qa` with real-world questions that customers actually ask,
rather than hand-authored guesses. Scrape → cluster → draft → bulk-import.

## Flow

```
scrape_faq.py      ─┐
scrape_reddit.py   ─┼─► *.jsonl ──► cluster_dedupe.py ──► clusters.jsonl
(future: amazon,   ─┘                                              │
 google PAA, yotpo)                                                ▼
                                                       generate_drafts.py
                                                                   │
                                                                   ▼
                                                          seed_drafts.jsonl
                                                                   │
                                                                   ▼
                                                       import into canon_qa
                                                       (status='draft')
```

Editor reviews every draft before promoting to `status='active'`.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../app/.env.example .env       # VOYAGE_API_KEY, ANTHROPIC_API_KEY, REDDIT_*
```

## Run

```bash
# 1. Purity's own FAQ / help pages
python scrape_faq.py --out seed_faq.jsonl --follow

# 2. Reddit customer-shaped questions
python scrape_reddit.py --out seed_reddit.jsonl --limit 60

# 3. Cluster and dedupe
python cluster_dedupe.py seed_faq.jsonl seed_reddit.jsonl --out clusters.jsonl

# 4. Draft Purity-voiced answers from the local knowledge base
python generate_drafts.py clusters.jsonl --out seed_drafts.jsonl --limit 300
```

## Open-access PDF fetcher

Pulls full-text for the ~172 open-access rows in the 448-article bibliography
and ingests them into pgvector. Run **after** `npm run import-bibliography`.

```bash
# Preview what would be resolved (no downloads)
python fetch_oa_pdfs.py --only-resolve --limit 20

# Real run — download + extract + chunk + embed + insert
python fetch_oa_pdfs.py

# Logs:
# knowledge-base/bibliography/oa_manifest.jsonl   (resolved URLs per DOI)
# knowledge-base/bibliography/unresolved.jsonl    (DOIs that didn't yield a PDF)
# knowledge-base/bibliography/pdfs/<drive_location>/<doi-slug>.pdf + .txt
```

Resolution order per DOI:
1. **NCBI ID Converter → PMCID → PMC OA PDF** (fastest, highest yield)
2. **Unpaywall** `best_oa_location.url_for_pdf`
3. Else → log in unresolved.jsonl

Idempotent: sets `sources.has_pdf = true` when a source is ingested, and
`fetch_oa_pdfs.py` filters on `has_pdf = false`, so re-runs only pick up new
or previously-failed rows.

Expected yield: ~80–90% of the 172 OA rows resolve cleanly. The rest are
publisher-hosted OA where the landing page returns HTML; those get added to
unresolved.jsonl for manual follow-up.

## Deferred seed sources

- **Purity customer reviews (44,925)** — Yotpo/Stamped export not yet accessible.
  When obtained, add `scrape_reviews.py` that dumps review text into the same
  JSONL shape and feeds into cluster_dedupe.
- **Amazon reviews** — add a scraper once we have a stable UA / rotating proxy
  strategy, or use a paid API. Ethics: only pull reviews of Purity SKUs.
- **Google "People Also Ask"** — worth harvesting for the top ~50 health-coffee
  queries; small corpus, high signal.

## Notes

- `cluster_dedupe.py` uses cosine-distance agglomerative clustering on Voyage
  embeddings. Threshold 0.22 works well on ~500-row inputs; tighten to 0.18 for
  larger corpora.
- `generate_drafts.py` uses Haiku 4.5 — the editor reviews everything, so the
  expensive Sonnet pass isn't justified at seed time.
- Every draft retains its `retrieved_paths` for editor audit; promoted canon
  rows carry these forward as `cited_chunk_ids` after the bulk-import maps
  paths → source_id → chunk_id.
