# Research Corpus — "Research for AI Project"

Source: Jeremy's Google Drive — the `Research for AI Project` folder containing the primary-literature background for *The Coffee Guide to Good Health* (Ildi Revi) and related CHC / Purity health-first coffee work.

Retrieved: 2026-04-23. Count: **34 papers** across 14 chapters.

## Layout

```
research/
  README.md                      # this file
  manifest.json                  # machine-readable index (fileId, chapter, title, paths, sha256)
  by-chapter/
    01/  02/  03/  04/  06/  07/  08/  09/  09.5/  10/  12/  14/  17/  18/
    unfiled/
```

Each chapter folder holds paired `{shortname}.pdf` + `{shortname}.txt`. The `.txt` is pdftotext `-layout` output, which preserves two-column layouts reasonably well and is suitable for chunk-and-embed pipelines.

## Chapter Index

| Chapter | Theme | Papers |
|---|---|---|
| 01 | Compound biology — trigonelline and alkaloids | fowlarczna-2016-trigonelline |
| 02 | Mortality and cohort evidence; contaminants context | mortality-nonwhite, bucheli-2002 |
| 03 | Type-2 diabetes, liver/HCV, acrylamide, metabolic risk | t2d-coffee, freedman-2012, freedman-2009-hepc, acrylamide-meta-analysis, dealmeida-2019, gans-2010 |
| 04 | Oxidative stress and cellular defense | moon-2009 |
| 06 | Acrylamide biology and chlorogenic-acid phytochemistry | ch06-paper-a/b/c/d/e |
| 07 | CGA bioactivity, roasting chemistry, cancer risk | rojas-gonzalez-2022-cga, pastoriza-2012, smrke-2013, shimazu-2005 |
| 08 | Cellular defense / CGA pharmacology | bakuradze-2010 |
| 09 | Mycotoxin risk at origin (processing, drying) | castellanos-onorio-2011 |
| 09.5 | Antioxidant capacity vs. roast; type-2 diabetes mechanism | chu-2009, ch09.5-paper-b, ch09.5-paper-c |
| 10 | Metabolic and diabetes pharmacology | ch10-paper-a, ch10-paper-b *(duplicates from 09.5 / 03)* |
| 12 | Liver — cirrhosis meta-analysis | corrao |
| 14 | Mycotoxins, melanoidins, OTA, acrylamide roasting chemistry | ota-primer, melanoidins-ch20, ota-roasting-2019, makowska-2014, ch14-paper-e |
| 17 | Cardiovascular and brain effects | sugiyama-2010 |
| 18 | Trigonelline biology (chapter 18 companion) | trigonelline-ch18 |

Known duplicates (same paper pulled under more than one chapter): `ch10-paper-a` ≈ `ch09.5-paper-c` (Fitoterapia 81 (2010) 297–305); `ch10-paper-b` ≈ `t2d-coffee` (Diabetologia 52:2561–2569). Keep both filings until a dedupe pass is run — the chapter context matters for retrieval even when the source is shared.

## Known gaps / follow-ups

- `trigonelline-ch18` returned the "Proofing your Book Chapter" document — this fileId points to an editing/proofing file rather than a primary-literature PDF. Re-identify the intended Ch 18 trigonelline paper and replace.
- The "Research for AI Project" Drive folder contains more papers than the 34 flagged here as priority. If the retrieval/RAG pipeline starts missing evidence, do another keyword sweep (see `manifest.json` build path for the pattern).
- Full citations (authors, journal, year, DOI) are not parsed out of the PDFs yet. If downstream tooling needs citation metadata, run a CrossRef lookup on the `title` field in `manifest.json`.

## Usage notes

- **For chunking:** use the `.txt` files. Target 800–1,200 token chunks with 100–200 token overlap. pdftotext output is clean enough for direct embedding; run a whitespace-normalization pass before chunking if your embedding model is sensitive.
- **For semantic search over a specific chapter:** filter on `manifest.json["papers"][*].chapter == "07"`.
- **For traceability:** every paper retains its original Drive `fileId` and `drive_url` — you can always round-trip to the canonical source.
- **Health-claim discipline:** this corpus is the evidence substrate for Reva's ANALYZE and CHALLENGE modes (see `../reva/SKILL.md`). When generating claims from this corpus, apply the Compound Reasoning Stack and Evidence Hierarchy — don't flatten observational associations into causal claims.
