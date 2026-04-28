# Reva — Knowledge-Base Mirror

This folder contains a frozen snapshot of the **Reva** skill as it existed at the time the lab-intelligence knowledge base was seeded.

Reva is Jeremy's health-first coffee expert thinking-partner skill: content producer,
evidence analyst, and adversarial challenger for Purity Coffee and CHC work. The canonical
live version lives at `/sessions/confident-sweet-brahmagupta/mnt/.claude/skills/reva/SKILL.md` and should be treated as the
source of truth. This copy exists so the knowledge-base ingestion pipeline (and anything
downstream — vector stores, retrieval agents, the lab-intelligence CS skill) can cite and
chunk Reva without reaching into the skills directory.

## Files

- `SKILL.md` — full Reva skill prompt: operating modes, Jeremy's voice, reasoning stacks
  (Compound Reasoning Stack, Evidence Hierarchy, Claim Validity Framework, Roast Chemistry
  Reasoning Map), CHC category-thinking frame, regulatory landscape, technical knowledge
  substrate (CGAs, melanoidins, trigonelline, caffeine, NMP, diterpenes, mycotoxins,
  acrylamide, pesticides, processing-and-health).

## Chunking guidance

Reva is already section-partitioned with `##`/`###` headings. When chunking for retrieval,
split on H2 boundaries (each operating mode, each reasoning protocol, technical knowledge
base, tone calibration table). Keep heading context with the chunk — these sections
cross-reference each other.

## Refresh policy

Re-copy this file whenever `SKILL.md` in the skills tree changes meaningfully. Track the
last-sync timestamp in the top-level `knowledge-base/README.md`.
