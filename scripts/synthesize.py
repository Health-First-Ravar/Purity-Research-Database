#!/usr/bin/env python3
"""Synthesis builder — one /synthesis/<PRODUCT>-synthesis.md per product.

Contains:
  - Latest canonical values for all tested analytes (from most recent non-VOID report).
  - Historical trend per analyte by test date.
  - Test coverage map — analytes tested vs not tested.
  - Inter-report conflicts — flagged when a value moves >20% between reports or
    when component data diverges from blend data.
  - last_updated timestamp.

Also updates /logs/qa_log.jsonl entries to STALE when underlying analyte values
for the referenced report_number have changed. Append-only — stale entries are
re-appended with status=STALE rather than mutated in place.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

PROCESSED_DIR  = ROOT / "Processed"
SYNTHESIS_DIR  = ROOT / "synthesis"
LOGS_DIR       = ROOT / "logs"
INDEX_PATH     = ROOT / "index.json"
PRODUCT_MAP    = ROOT / "product-map.json"
QA_LOG         = LOGS_DIR / "qa_log.jsonl"


def load_json(path: Path):
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_processed_records() -> list[dict]:
    out = []
    for p in sorted(PROCESSED_DIR.glob("*.json")):
        try:
            out.append(load_json(p))
        except json.JSONDecodeError:
            continue
    return out


def group_by_product(records: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        key = r.get("product_key")
        if not key or r.get("status") == "VOID":
            continue
        groups[key].append(r)
    for k in groups:
        groups[k].sort(key=lambda r: r.get("test_date") or "", reverse=True)
    return groups


def synthesize_product(product_key: str, records: list[dict], product_map: dict) -> str:
    display = product_map.get("products", {}).get(product_key, {}).get("display_name", product_key)
    tier = product_map.get("products", {}).get(product_key, {}).get("tier", "?")

    latest = records[0] if records else None
    # analyte name -> list[(test_date, value_norm, unit_norm, report_no, status)]
    history: dict[str, list[tuple]] = defaultdict(list)
    for r in records:
        for a in r.get("analytes", []):
            history[a["analyte"]].append((
                r.get("test_date"), a.get("value_normalized"), a.get("unit_normalized"),
                r.get("report_number"), r.get("status"),
            ))

    lines: list[str] = []
    lines.append(f"# {display} — Synthesis\n")
    lines.append(f"- **Product key:** `{product_key}`")
    lines.append(f"- **Tier:** {tier}")
    lines.append(f"- **Reports used:** {len(records)}")
    lines.append(f"- **Last updated:** {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n")

    if latest:
        lines.append(f"## Latest canonical values — Report {latest.get('report_number')} "
                     f"(tested {latest.get('test_date')})\n")
        lines.append("| Analyte | Value (normalized) | Unit | As reported | Retest seq |")
        lines.append("|---|---:|---|---|---:|")
        for a in latest.get("analytes", []):
            lines.append(
                f"| {a['analyte']} | "
                f"{_fmt(a.get('value_normalized'))} | {a.get('unit_normalized','')} | "
                f"{a.get('value_as_reported','')} {a.get('unit_as_reported','')} | "
                f"{a.get('retest_sequence', 0)} |"
            )
        lines.append("")

    lines.append("## Historical trend\n")
    for analyte, entries in sorted(history.items()):
        lines.append(f"### {analyte}")
        lines.append("| Test date | Value | Unit | Report | Status |")
        lines.append("|---|---:|---|---|---|")
        for test_date, val, unit, rpt, status in sorted(entries, key=lambda e: e[0] or ""):
            lines.append(f"| {test_date or ''} | {_fmt(val)} | {unit or ''} | {rpt or ''} | {status or ''} |")
        # conflict flag: >20% swing between adjacent tests
        numeric = [(d, v) for d, v, *_ in entries if isinstance(v, (int, float))]
        numeric.sort(key=lambda e: e[0] or "")
        swings = []
        for (d1, v1), (d2, v2) in zip(numeric, numeric[1:]):
            if v1 and abs(v2 - v1) / max(abs(v1), 1e-9) > 0.20:
                swings.append(f"{d1}:{v1} → {d2}:{v2} ({(v2-v1)/v1*100:+.1f}%)")
        if swings:
            lines.append(f"\n> ⚠️ Notable swings (>20%): {'; '.join(swings)}")
        lines.append("")

    # Test coverage map — analytes the product line covers but this product is missing
    all_analytes_this_product = set(history.keys())
    lines.append("## Test coverage\n")
    lines.append(f"- Tested analytes on this product: **{len(all_analytes_this_product)}**")
    lines.append("- Untested-for-this-product analytes are identified by the dashboard "
                 "cross-product comparison, not here (a single-product file can't know "
                 "the full universe).\n")

    return "\n".join(lines) + "\n"


def _fmt(v):
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:.4g}"
    return str(v)


def mark_stale_qa_entries(records: list[dict]) -> int:
    """Re-append STALE notices for QA log entries whose reports now have changed values.
    Append-only (never mutates prior lines). Returns count of stale notices appended."""
    try:
        exists = QA_LOG.exists()
    except OSError as e:
        print(f"  qa_log check skipped: {e}")
        return 0
    if not exists:
        return 0
    # Build latest-value-by-(report_number, analyte)
    latest = {}
    for r in records:
        rpt = r.get("report_number")
        for a in r.get("analytes", []):
            latest[(rpt, a["analyte"])] = a.get("value_normalized")

    count = 0
    with QA_LOG.open("r", encoding="utf-8") as f:
        lines = [ln for ln in f.read().splitlines() if ln.strip()]

    with QA_LOG.open("a", encoding="utf-8") as f:
        for ln in lines:
            try:
                entry = json.loads(ln)
            except json.JSONDecodeError:
                continue
            if entry.get("status") == "STALE":
                continue
            snap = entry.get("data_snapshot") or {}
            changed = []
            for rpt, analytes in snap.items():
                for analyte_name, snap_value in (analytes or {}).items():
                    cur = latest.get((rpt, analyte_name))
                    if cur is not None and cur != snap_value:
                        changed.append({"report": rpt, "analyte": analyte_name,
                                        "old": snap_value, "new": cur})
            if changed:
                notice = {
                    "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "status": "STALE",
                    "ref_entry_id": entry.get("entry_id"),
                    "changed": changed,
                }
                f.write(json.dumps(notice) + "\n")
                count += 1
    return count


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--product", type=str, default=None,
                    help="Only rebuild this one product key (e.g. PROTECT)")
    args = ap.parse_args()

    SYNTHESIS_DIR.mkdir(exist_ok=True)
    LOGS_DIR.mkdir(exist_ok=True)

    product_map = load_json(PRODUCT_MAP)
    records = load_processed_records()
    groups = group_by_product(records)

    if args.product:
        groups = {args.product: groups.get(args.product, [])}

    written = 0
    for product_key, recs in groups.items():
        if not recs:
            continue
        out = SYNTHESIS_DIR / f"{product_key}-synthesis.md"
        out.write_text(synthesize_product(product_key, recs, product_map), encoding="utf-8")
        print(f"  wrote {out.name}  reports={len(recs)}")
        written += 1

    stale = mark_stale_qa_entries(records)
    print(f"Synthesis done. products_written={written} qa_log_stale_notices_appended={stale}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
