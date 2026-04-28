# Purity / CHC Knowledge Base

The primary retrieval substrate for the Purity Coffee Lab Intelligence System and for Reva-mediated content, analysis, and educational work. Four sources, kept separate so each can evolve on its own refresh cadence.

Built: 2026-04-23. Maintainer: Jeremy Rävar.

```
knowledge-base/
├── README.md            # this file
├── reva/                # the Reva skill — operating mode, tone, reasoning protocols
├── purity-brain/        # Coda-sourced brand, strategy, Org DNA, customer evidence
├── coffee-book/         # Ildi Revi's "The Coffee Guide to Better Health"
├── research/            # 34 primary-literature PDFs + text (book-chapter organized)
└── bibliography/        # 448-article catalog xlsx — DOIs, topics, rights (catalog-only)
```

## What each source is for

| Source | What it contains | Use it when you want to… |
|---|---|---|
| `reva/` | The canonical SKILL.md that defines Reva's 3 operating modes (CREATE / ANALYZE / CHALLENGE), evidence hierarchy, compound-reasoning stack, voice for Jeremy, and category framing for health-first coffee. | …retrieve *how* Reva should think or write about a given topic. This is process, not subject matter. |
| `purity-brain/` | Brand positioning and voice, visual identity, Org DNA (beliefs / vision / purpose / strategy across seven categories), decision frameworks (PR scorecard, Andrew's email voice), customer evidence (1,507-review "only coffee I can drink" analysis, consumer-video script). | …align a claim, a piece of copy, or a strategic move with Purity's actual brand and business. Source of truth for *what Purity says and does*. |
| `coffee-book/` | Currently: the 841 KB preview / marketing PDF of Ildi Revi's *The Coffee Guide to Better Health*, extracted to text. Deferred: the 106 MB full book. | …pull Ildi's framing, the CHC 9-stage cycle, and the educational architecture of the book. The authoritative voice for CHC curriculum. |
| `research/` | 34 primary-literature PDFs and text extractions, organized into 14 chapter folders that correspond to book chapters. Topics span CGAs, mycotoxins, acrylamide, T2D, cirrhosis, Parkinson's, OTA, melanoidins, trigonelline. | …back a claim with actual peer-reviewed evidence, or run Reva's ANALYZE / CHALLENGE modes against new studies or competitor claims. |
| `bibliography/` | Catalog-only (no full-text yet): Jeremy's curated xlsx of 448 articles organized by medical topic (Cancer, CV, T2D, GI, Longevity, Performance, Alzheimer's, Parkinson's, Depression, Obesity, Mental Health, Related). DOI + year + rights flags on every row; 172 are open-access. | …surface "is there a paper on X?" inside the Bibliography page, then resolve to full-text via DOI lookup when needed. Superset of `research/`. |

## Correspondence between the book and the research folder

Both use the same chapter numbering. When the full book is ingested and split by chapter, the `coffee-book/by-chapter/XX.txt` and `research/by-chapter/XX/` directories will pair one-to-one. This lets retrieval answer compound queries like:

> "What does the book say about ochratoxin A, and what does the primary evidence actually show?"

…with a single filter of `chapter == "14"` across both directories.

## Chunking guidance (for downstream RAG / vector-store ingestion)

- **reva/SKILL.md** — chunk by H2/H3 headings. Each mode, each reasoning protocol, each knowledge-substrate subsection is a meaningful unit. 500–900 tokens per chunk. Keep the mode header (CREATE / ANALYZE / CHALLENGE) in the chunk metadata so retrieval can filter by mode.
- **purity-brain/** — each numbered file (`00_core-instructions.md` through `05_customer-evidence.md`) is pre-organized by retrieval concern. Chunk by H2. The brand positioning and voice file in particular should be chunked finely — the three voice attributes, the brand filter, and the text guidelines are separate retrieval units.
- **coffee-book/** — once the full book is ingested, chunk by chapter H2 with 800–1,200 token chunks and 150-token overlap. Preserve the chapter number in metadata.
- **research/** — use the `.txt` files (not the PDFs). 800–1,200 tokens per chunk, 150-token overlap. Keep `fileId`, `chapter`, and `shortname` from `manifest.json` in metadata so retrieval can filter by chapter and round-trip to the canonical Drive source.

## Metadata tags worth keeping on every chunk

- `source` — one of `reva | purity-brain | coffee-book | research`
- `chapter` — string `"01"` through `"18"` or `"09.5"`, or `null` for brand / skill content
- `fileId` — Drive fileId for the source paper (research only)
- `shortname` — human-recognizable paper handle (research only)
- `heading` — the nearest H2 or H3 heading above the chunk
- `title` — the paper title for research papers; the section title for purity-brain and reva

Filtering on `source` is the most useful first-cut filter — most queries want either brand-voice grounding (`purity-brain` + `reva`) or evidence grounding (`research` + `coffee-book`), rarely both simultaneously.

## Refresh cadence

| Source | Refresh trigger | How |
|---|---|---|
| `reva/` | When SKILL.md is edited (rare — this is a carefully curated skill) | Re-copy `/mnt/.claude/skills/reva/SKILL.md` into `reva/SKILL.md` |
| `purity-brain/` | When Coda tables (Org DNA, Brand Guidelines, Core Instructions, Content) change | Re-run the Coda → markdown extraction, overwrite files 00–05 |
| `coffee-book/` | When Ildi publishes a revision | Re-download the full PDF, re-split by chapter |
| `research/` | When the "Research for AI Project" Drive folder gets new papers, or when Reva or Ildi flags a gap | Re-run the Drive keyword sweeps, add to `manifest.json`, extract into `by-chapter/XX/` |

## Known open items

- `coffee-book/` has only the preview PDF. Full book (106 MB) ingestion is deferred to a local-terminal pipeline — see `coffee-book/README.md`.
- `research/manifest.json` has 34 papers. The Drive folder contains more than this. If retrieval starts missing evidence, do another keyword sweep and extend.
- `research/by-chapter/18/trigonelline-ch18.txt` came back as the "Proofing your Book Chapter" editing file rather than a primary-literature PDF — the intended Ch 18 trigonelline paper needs to be re-identified and replaced.
- Several research papers appear in multiple chapter folders (`ch10-paper-a` ≈ `ch09.5-paper-c`; `ch10-paper-b` ≈ `t2d-coffee`). **Kept duplicated on purpose** — chapter context matters for retrieval and the chunks are parented to chapter-specific source rows. The `bibliography_view` (migration 0003) deduplicates by DOI for the Bibliography page so the user sees one row per paper.

## Dedupe pass (2026-04-23)

Ran `dashboard/app/scripts/dedupe-research.ts` to unify the 34 ingested research sources with the 448-row bibliography catalog. Results:

- **28/34 papers** resolved a DOI directly from the .txt (82% yield after ligature normalization for PDF-to-text artifacts like `ﬁ` → `fi`)
- **1 paper** resolved via `scripts/manual_doi_overrides.json` (freedman-2012 NEJM — DOI not printed inline, per NEJM convention)
- **5 residuals** — papers where the DOI is neither printable in the PDF nor hand-verified yet:
  - `06/ch06-paper-b.txt` (Acrylamide and Cancer Risk — short piece, likely a non-indexed commentary)
  - `06/ch06-paper-d.txt` (Chemical Hazard :: Acrylamide — looks like a food-safety bulletin, not a peer-reviewed article)
  - `12/corrao.txt` (Corrao — Coffee, Caffeine, and the Risk of Liver Cirrhosis — DOI recoverable via PubMed search if needed)
  - `14/ch14-paper-e.txt` (Melanoidins from coffee and lipid peroxidation — DOI recoverable via PubMed)
  - `18/trigonelline-ch18.txt` (mislabeled file — known open item above)
- Residuals have `has_pdf=true` set so they still surface in the Bibliography page; they just lack `topic_category` and `drive_location` metadata from the xlsx. Re-run is idempotent — add their DOIs to `manual_doi_overrides.json` and re-run to pick them up.

Full per-paper report is written to `research/dedupe_report.json` on each run.
