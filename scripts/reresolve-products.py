#!/usr/bin/env python3
"""Re-apply product resolution to existing Processed/*.json records.

After product-map.json changes, records parsed earlier keep their old
product_key. This re-runs resolve_product() against each record's STORED
sample_name / lot_or_po / source_file (no PDF re-parse needed) and updates
product_key + status when the mapping changed. index.json is kept in sync.

Status follows build_record's rule: a resolved record is OK (or LOW_CONFIDENCE
when parse_confidence < 0.6); an unresolved record is UNRESOLVED unless it is
LOW_CONFIDENCE / VOID. Idempotent.

Usage:
  python3 scripts/reresolve-products.py --dry-run
  python3 scripts/reresolve-products.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from ingest import resolve_product, load_json, save_json  # noqa: E402
from lib_extract import COAEnvelope  # noqa: E402

PROCESSED = ROOT / "Processed"
INDEX = ROOT / "index.json"
PRODUCT_MAP = ROOT / "product-map.json"


def _status_for(record: dict, product_key) -> str:
    status = record.get("status") or "OK"
    if status in ("VOID",):
        return status
    base = "LOW_CONFIDENCE" if (record.get("parse_confidence") or 1.0) < 0.6 else "OK"
    if product_key is None:
        return "UNRESOLVED" if base == "OK" else base
    return base


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    product_map = load_json(PRODUCT_MAP)
    index = load_json(INDEX)
    changed = 0

    for p in sorted(PROCESSED.glob("*.json")):
        d = load_json(p)
        env = COAEnvelope(source_file=d.get("source_file"), source_hash=d.get("source_hash") or "")
        env.sample_name = d.get("sample_name")
        env.lot_or_po = d.get("lot_or_po")
        new_key = resolve_product(env, product_map)
        if new_key == d.get("product_key"):
            continue
        new_status = _status_for(d, new_key)
        changed += 1
        print(f"  {p.name}: product_key {d.get('product_key')} -> {new_key}"
              f"  status {d.get('status')} -> {new_status}  (sample={d.get('sample_name')})")
        if args.dry_run:
            continue
        d["product_key"] = new_key
        d["status"] = new_status
        save_json(p, d)
        # keep index entry in sync (keyed by source basename)
        for _fname, entry in index.get("files", {}).items():
            if entry.get("processed_path") and (ROOT / entry["processed_path"]) == p:
                entry["product_key"] = new_key
                entry["status"] = new_status

    if not args.dry_run and changed:
        save_json(INDEX, index)
    print(f"[reresolve] {'would update' if args.dry_run else 'updated'} {changed} record(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
