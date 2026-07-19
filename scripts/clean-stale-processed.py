#!/usr/bin/env python3
"""Idempotent cleanup of stale Processed/*.json records.

Three independent rules, all safe to run on every sync:

  1. Dead shells — delete any Processed record with ZERO analytes AND no report
     number. These carry no usable data (branding sheets, cover letters, scans
     the parser cannot read). ingest.py now quarantines such files up front; this
     retro-removes ones written before that guard existed. The source PDF stays
     in COAs/, so a later parser improvement can re-emit a real record.

  2. Duplicate collapse — when several records share the SAME (source_file,
     report_number), keep the one with the most analytes (tie-break: higher
     parse_confidence) and delete the rest. This is what leaves "49608.pdf" with
     only its 19-analyte Trilogy parse. Records that share a source_file but have
     DISTINCT report numbers are legitimate multi-sample COAs (one .docx holding
     many lab results) and are all kept.

  3. Orphan prune — delete records whose source_file is no longer in COAs/. This
     only runs when COAs/ looks complete (at least as many files as there are
     distinct Processed sources); otherwise it is skipped with a warning, so a
     partial local checkout can never nuke records whose source just is not
     synced to this machine. In CI, COAs/ is the full Drive mirror.

index.json is kept consistent: a files entry whose processed_path was deleted is
re-pointed to a surviving sibling for the same source, or marked QUARANTINED with
processed_path=None when nothing survives.

Usage:
  python3 scripts/clean-stale-processed.py --dry-run
  python3 scripts/clean-stale-processed.py
"""
from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "Processed"
COAS = ROOT / "COAs"
INDEX = ROOT / "index.json"


def _analytes(d: dict) -> int:
    return len(d.get("analytes") or [])


def _report(d: dict) -> str:
    return (d.get("report_number") or "").strip()


def _src(d: dict) -> str:
    return os.path.basename(d.get("source_file") or "")


def clean(*, dry_run: bool = False) -> dict:
    docs: dict[Path, dict] = {}
    for p in sorted(PROCESSED.glob("*.json")):
        try:
            docs[p] = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue

    to_delete: set[Path] = set()

    # Rule 1 — dead shells (0 analytes, no report number).
    for p, d in docs.items():
        if _analytes(d) == 0 and not _report(d):
            to_delete.add(p)

    # Rule 2 — collapse exact (source_file, report_number) duplicates.
    groups: dict[tuple, list[Path]] = defaultdict(list)
    for p, d in docs.items():
        if p in to_delete:
            continue
        rn = _report(d)
        if rn:
            groups[(_src(d), rn)].append(p)
    for (_key, paths) in groups.items():
        if len(paths) < 2:
            continue
        # A record carrying a sample_id is strictly better identified than one
        # without, so it wins ahead of analyte count. Without this, migration
        # 0012's rename loses: the pre-0012 `<report>.json` and the new
        # `<report>__S<id>.json` parse identically from the same source, the
        # first two keys tie, and `max` keeps whichever sorts first — which is
        # always the old name, since "." < "_". The re-ingest then silently
        # undoes itself.
        best = max(
            paths,
            key=lambda p: (
                bool(docs[p].get("sample_id")),
                _analytes(docs[p]),
                docs[p].get("parse_confidence") or 0,
            ),
        )
        for p in paths:
            if p != best:
                to_delete.add(p)

    # Rule 3 — orphans whose source_file is gone from COAs/ (gated on completeness).
    coas_names = {p.name for p in COAS.iterdir() if p.is_file()} if COAS.is_dir() else set()
    distinct_sources = {_src(d) for d in docs.values() if _src(d)}
    orphan_prune = len(coas_names) >= len(distinct_sources) and len(coas_names) > 0
    orphans = 0
    if orphan_prune:
        for p, d in docs.items():
            if p in to_delete:
                continue
            s = _src(d)
            if s and s not in coas_names:
                to_delete.add(p)
                orphans += 1
    else:
        print(f"[clean-stale] orphan prune SKIPPED — COAs/ has {len(coas_names)} files "
              f"vs {len(distinct_sources)} distinct Processed sources (partial checkout).")

    deleted_rel = {str(p.relative_to(ROOT)) for p in to_delete}
    summary = {
        "total": len(docs),
        "to_delete": len(to_delete),
        "dead_shells": sum(1 for p in to_delete if _analytes(docs[p]) == 0 and not _report(docs[p])),
        "orphans": orphans,
        "kept": len(docs) - len(to_delete),
    }
    print(f"[clean-stale] total={summary['total']} delete={summary['to_delete']} "
          f"(dead_shells={summary['dead_shells']} orphans={summary['orphans']}) kept={summary['kept']}")

    if dry_run:
        for p in sorted(to_delete):
            print(f"  would delete: {p.name}  src={_src(docs[p])[:45]}  analytes={_analytes(docs[p])}")
        return summary

    for p in to_delete:
        try:
            p.unlink()
        except FileNotFoundError:
            pass

    # Keep index.json consistent.
    if INDEX.exists():
        idx = json.load(open(INDEX, encoding="utf-8"))
        files = idx.get("files", {})
        # Surviving Processed by source basename, best first.
        surviving: dict[str, list[Path]] = defaultdict(list)
        for p, d in docs.items():
            if p not in to_delete:
                surviving[_src(d)].append(p)
        for src, paths in surviving.items():
            paths.sort(key=lambda p: (_analytes(docs[p]), docs[p].get("parse_confidence") or 0), reverse=True)
        for key, entry in files.items():
            pp = entry.get("processed_path")
            if pp and pp in deleted_rel:
                alt = surviving.get(os.path.basename(entry.get("source_file") or key))
                if alt:
                    entry["processed_path"] = str(alt[0].relative_to(ROOT))
                else:
                    entry["processed_path"] = None
                    if entry.get("status") not in ("VOID",):
                        entry["status"] = "QUARANTINED"
        tmp = INDEX.with_suffix(".json.tmp")
        json.dump(idx, open(tmp, "w", encoding="utf-8"), indent=2)
        os.replace(tmp, INDEX)

    print(f"[clean-stale] deleted {len(to_delete)} records")
    return summary


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    clean(dry_run=args.dry_run)
