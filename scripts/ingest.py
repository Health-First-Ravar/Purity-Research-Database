#!/usr/bin/env python3
"""Ingestion pipeline — Purity Lab Intelligence.

Usage:
  python3 ingest.py                     # process new files in /COAs
  python3 ingest.py --dry-run           # report what would happen, write nothing
  python3 ingest.py --force             # reprocess every file (ignores index hashes)
  python3 ingest.py --file PATH         # process a single file

What it does per file:
  1. Extract envelope + analyte rows (lib_extract).
  2. Collapse retests — last value wins (lib_extract.collapse_retests).
  3. Normalize units (lib_units).
  4. Resolve sample -> product via product-map.json. If no match: status=UNRESOLVED.
  5. If supersedes another report: mark the older one VOID in index.json.
  6. If parse_confidence < 0.6: status=LOW_CONFIDENCE (still written, but flagged).
  7. Write /Processed/<report_number_or_hash>.json.
  8. Append file entry to index.json.
  9. At end of run: update last_successful_sync (if at least one file completed).

Design notes (Myco review):
  - Log writes elsewhere in the system are append-only; this ingester holds an
    exclusive lock on index.json via an advisory lockfile (scripts/.index.lock)
    since index.json is single-writer by design.
  - Staleness: last_successful_sync is only stamped on a clean run.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from lib_extract import extract, collapse_retests, COAEnvelope, AnalyteRow  # noqa: E402
from lib_units import normalize  # noqa: E402

COAS_DIR       = ROOT / "COAs"
PROCESSED_DIR  = ROOT / "Processed"
LOGS_DIR       = ROOT / "logs"
SYNTHESIS_DIR  = ROOT / "synthesis"
INDEX_PATH     = ROOT / "index.json"
PRODUCT_MAP    = ROOT / "product-map.json"
LOCK_PATH      = HERE / ".index.lock"


# --------------- io helpers ---------------

def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=False)
    os.replace(tmp, path)


def acquire_lock(timeout: float = 30.0) -> None:
    start = time.time()
    while True:
        try:
            fd = os.open(str(LOCK_PATH), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return
        except FileExistsError:
            if time.time() - start > timeout:
                raise RuntimeError(f"index.json lock not released after {timeout}s")
            time.sleep(0.5)


def release_lock() -> None:
    try:
        LOCK_PATH.unlink()
    except FileNotFoundError:
        pass


# --------------- product resolution ---------------

def resolve_product(envelope: COAEnvelope, product_map: dict) -> Optional[str]:
    s2p = product_map.get("sample_to_product", {})
    candidates = []
    if envelope.sample_name:
        candidates.append(envelope.sample_name.strip())
    if envelope.lot_or_po:
        candidates.append(envelope.lot_or_po.strip())
    for c in candidates:
        if c in s2p:
            return s2p[c]
        low = c.lower()
        for key, prod in s2p.items():
            if key.lower() == low or low in key.lower() or key.lower() in low:
                return prod
        # alias match by product display names
        for product_key, meta in product_map.get("products", {}).items():
            names = [meta.get("display_name", ""), product_key, *meta.get("aliases", [])]
            if any(n and n.lower() in low for n in names):
                return product_key
    return None


# --------------- canonical record builder ---------------

def build_record(env: COAEnvelope, product_key: Optional[str]) -> dict:
    canonical_analytes = []
    for row in env.analytes:
        v_norm, unit_norm, v_orig, unit_orig = normalize(
            row.analyte, row.value_raw, row.unit_raw, env.serving_size_g
        )
        canonical_analytes.append({
            "analyte": row.analyte,
            "panel": row.panel,
            "value_normalized": v_norm,
            "unit_normalized": unit_norm,
            "value_as_reported": row.value_raw,
            "unit_as_reported": unit_orig or row.unit_raw,
            "method": row.method,
            "loq": row.loq,
            "retest_sequence": row.retest_sequence,
        })
    status = "OK"
    if env.parse_confidence < 0.6:
        status = "LOW_CONFIDENCE"
    if product_key is None:
        status = "UNRESOLVED" if status == "OK" else status
    return {
        "schema_version": 1,
        "status": status,
        "product_key": product_key,
        "report_number": env.report_number,
        "test_date": env.test_date,
        "sample_name": env.sample_name,
        "lot_or_po": env.lot_or_po,
        "supersedes": env.supersedes,
        "superseded_by": None,
        "lab": env.lab,
        "serving_size_g": env.serving_size_g,
        "source_file": env.source_file,
        "source_hash": env.source_hash,
        "parse_confidence": round(env.parse_confidence, 3),
        "parse_notes": env.parse_notes,
        "analytes": canonical_analytes,
        "ingested_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


# --------------- main ingestion ---------------

def process_file(path: Path, index: dict, product_map: dict, *, dry_run: bool, force: bool) -> Optional[dict]:
    key = path.name
    existing = index.get("files", {}).get(key)
    env = extract(path)
    if existing and not force and existing.get("source_hash") == env.source_hash:
        print(f"  skip (unchanged): {key}")
        return None

    env = collapse_retests(env)
    product_key = resolve_product(env, product_map)
    record = build_record(env, product_key)

    out_name = (record["report_number"] or env.source_hash) + ".json"
    out_path = PROCESSED_DIR / out_name

    if dry_run:
        print(f"  DRY-RUN would write: {out_path.name}  status={record['status']}  product={product_key}")
        return None

    save_json(out_path, record)

    entry = {
        "source_file": env.source_file,
        "source_hash": env.source_hash,
        "processed_path": str(out_path.relative_to(ROOT)),
        "report_number": record["report_number"],
        "test_date": record["test_date"],
        "sample_name": record["sample_name"],
        "lot_or_po": record["lot_or_po"],
        "product_key": product_key,
        "status": record["status"],
        "supersedes": record["supersedes"],
        "superseded_by": None,
        "parse_confidence": record["parse_confidence"],
        "ingested_at": record["ingested_at"],
    }
    index.setdefault("files", {})[key] = entry

    # flag lists
    if record["status"] == "UNRESOLVED":
        _append_unique(index.setdefault("unresolved_samples", []),
                       {"file": key, "sample_name": env.sample_name, "lot_or_po": env.lot_or_po})
    if record["status"] == "LOW_CONFIDENCE":
        _append_unique(index.setdefault("low_confidence_parses", []),
                       {"file": key, "parse_notes": env.parse_notes})

    # supersede linkage — mark older report VOID
    if record["supersedes"]:
        older = _find_by_report(index, record["supersedes"])
        if older:
            older_entry = index["files"][older]
            older_entry["status"] = "VOID"
            older_entry["superseded_by"] = record["report_number"]
            _append_unique(index.setdefault("void_reports", []),
                           {"void_file": older, "void_report_number": record["supersedes"],
                            "superseded_by_report": record["report_number"]})
            # also patch the processed JSON of the older one
            older_processed = ROOT / older_entry["processed_path"]
            if older_processed.exists():
                older_doc = load_json(older_processed)
                older_doc["status"] = "VOID"
                older_doc["superseded_by"] = record["report_number"]
                save_json(older_processed, older_doc)

    print(f"  ingested: {key}  status={record['status']}  report={record['report_number']}  product={product_key}")
    return record


def _append_unique(lst: list, entry: dict) -> None:
    if entry not in lst:
        lst.append(entry)


def _find_by_report(index: dict, report_number: str) -> Optional[str]:
    for fname, meta in index.get("files", {}).items():
        if meta.get("report_number") == report_number:
            return fname
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--file", type=str, default=None,
                    help="Ingest a single file (absolute path or relative to /COAs)")
    args = ap.parse_args()

    for d in (COAS_DIR, PROCESSED_DIR, LOGS_DIR, SYNTHESIS_DIR):
        d.mkdir(exist_ok=True)

    product_map = load_json(PRODUCT_MAP)
    index = load_json(INDEX_PATH) or {
        "schema_version": 1, "files": {},
        "void_reports": [], "unresolved_samples": [], "low_confidence_parses": [],
        "last_successful_sync": None, "last_sync_attempt": None, "last_sync_error": None,
    }

    acquire_lock()
    try:
        if args.file:
            p = Path(args.file)
            if not p.is_absolute():
                p = COAS_DIR / args.file
            if not p.exists():
                print(f"ERROR: {p} not found", file=sys.stderr)
                return 2
            targets = [p]
        else:
            targets = [p for p in COAS_DIR.iterdir()
                       if p.is_file() and p.suffix.lower() in {".pdf", ".docx"}]

        print(f"Scanning {COAS_DIR} — {len(targets)} candidate file(s).")
        processed_any = False
        errors: list[str] = []

        for path in sorted(targets):
            try:
                rec = process_file(path, index, product_map,
                                   dry_run=args.dry_run, force=args.force)
                if rec:
                    processed_any = True
            except Exception as e:
                msg = f"{path.name}: {type(e).__name__}: {e}"
                print(f"  ERROR: {msg}", file=sys.stderr)
                errors.append(msg)

        now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
        index["last_sync_attempt"] = now_iso
        if not errors and not args.dry_run:
            index["last_successful_sync"] = now_iso
            index["last_sync_error"] = None
        elif errors:
            index["last_sync_error"] = errors[:5]

        if not args.dry_run:
            save_json(INDEX_PATH, index)

        print(f"Done. new/updated={processed_any} errors={len(errors)}"
              f" last_successful_sync={index.get('last_successful_sync')}")
        return 0 if not errors else 1
    finally:
        release_lock()


if __name__ == "__main__":
    sys.exit(main())
