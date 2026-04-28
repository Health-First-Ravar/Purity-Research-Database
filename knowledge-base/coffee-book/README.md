# The Coffee Guide to Better Health — Ildi Revi

Canonical health-first coffee book. Serves as the foundational curriculum source for CHC (Circular Health Coffee) programming and as the primary long-form knowledge artifact for downstream Reva / RAG pipelines.

Author: **Ildi Revi**, Chief Learning Officer, Purity Coffee. Editorial contribution and graphics by Jeremy Rävar.

## Versions on Google Drive

| Version | fileId | Size | Status here |
|---|---|---|---|
| `The Coffee Guide to Better Health.pdf` (full book, w/ photos) | `1wlifzHxcdcXF8OdmwQBiwWNck8-VtcQt` | **106 MB** | **Deferred** — too large for in-conversation extraction. See below. |
| `The Coffee Guide to Better Health V-1-Photos.pdf` | `1j-1opXf4WPQX7q2JtwZZYyRc8lN4gx1j` | 25 MB | Deferred — large but feasible via split. |
| `The Coffee Guide to Better Health_SC.pdf` (marketing / preview) | `1ZPiFK0HOqKF529xEKvFD7xsMdHL57hdR` | 860 KB | **Extracted** → `coffee-guide_sc.pdf` + `.txt` |
| `The Coffee Guide to Better Health_7x10_sample 1.pdf` | `1QNlMYC5-aSHOWUp0TbwnvmV1N8NvbPfb` | 957 KB | Not yet pulled. |

## What's here now

- `coffee-guide_sc.pdf` — book's preview / marketing summary (841 KB)
- `coffee-guide_sc.txt` — pdftotext layout extraction of the preview. Contains: elevator pitch, chapter-level table-of-contents positioning, key compound claims, Chopra foreword endorsement. Suitable for top-level retrieval but not for chapter-detail queries.

This preview establishes the book's framing and the Circular Health Coffee vocabulary, which is enough to anchor category-level reasoning when the full text is not yet chunked.

## Deferred: full-book ingestion

The full 106 MB book cannot be round-tripped through a single `download_file_content` call — the base64 blob exceeds tool-response limits, and in-memory extraction is impractical for a file of that size.

Path to complete:

1. Download the full PDF directly in a local terminal (outside of Claude) using the Drive `fileId` `1wlifzHxcdcXF8OdmwQBiwWNck8-VtcQt` and the Drive API, save to `knowledge-base/coffee-book/coffee-guide-full.pdf`.
2. Run `pdftotext -layout coffee-guide-full.pdf coffee-guide-full.txt` to get a clean layout extraction.
3. Split by chapter — the book has a clear H1/H2 structure. Emit `by-chapter/01.txt` through `by-chapter/18.txt`.
4. Write a `manifest.json` with per-chapter byte counts and the chapter titles (from the book's TOC) so that retrieval queries can filter by chapter the same way the `research/` folder does.

The 34 primary-literature papers in `../research/by-chapter/` are already organized under the same chapter numbering, which means once the book chapters are split, the research corpus and the book will sit in one-to-one correspondence by chapter — an ideal structure for compound retrieval ("give me what the book says about OTA in Chapter 14, plus the primary evidence").

## Source-of-truth notes

- The book is **not** public-domain or licensed for reproduction. Keep extracted text inside this knowledge-base for retrieval / QA / content-generation purposes only.
- When quoting extensively from the book in Reva-authored content, attribute to Ildi Revi and *The Coffee Guide to Better Health*.
- Ildi is the author and voice-authority here. Jeremy's role on this book was editorial and graphics — not primary authorship.
