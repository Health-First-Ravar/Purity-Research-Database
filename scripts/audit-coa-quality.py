#!/usr/bin/env python3
"""COA parse-quality X-ray.

Scans every Processed/*.json and reports which COAs came in 'half-baked':
zero analytes, low confidence, missing date, or stale duplicates. Prints a
ranked console summary (worst first) and exits non-zero if any record has zero
analytes — so it can gate the COA sync workflow and surface bad parses in CI.

Usage:
  python3 scripts/audit-coa-quality.py            # console report
  python3 scripts/audit-coa-quality.py --strict   # exit 1 if any zero-analyte
"""
from __future__ import annotations
import json, glob, os, sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "Processed"


def load():
    rows = []
    for f in sorted(PROCESSED.glob("*.json")):
        try:
            d = json.load(open(f))
        except Exception as e:
            rows.append({"file": f.name, "lab": "PARSE_ERROR", "status": str(e)[:40],
                         "analytes": 0, "date": "", "report": "", "conf": 0,
                         "blend": "", "src": f.name})
            continue
        rows.append({
            "file": f.name,
            "lab": (d.get("lab") or "")[:42],
            "status": d.get("status") or "",
            "analytes": len(d.get("analytes") or []),
            "date": d.get("test_date") or "",
            "report": d.get("report_number") or "",
            "conf": d.get("parse_confidence") if d.get("parse_confidence") is not None else "",
            "blend": d.get("product_key") or "",
            "src": os.path.basename(d.get("source_file") or "") or f.name,
        })
    return rows


def main():
    strict = "--strict" in sys.argv
    rows = load()
    zero = [r for r in rows if r["analytes"] == 0]
    nodate = [r for r in rows if not r["date"]]
    lowconf = [r for r in rows if isinstance(r["conf"], (int, float)) and r["conf"] < 0.6]

    # stale duplicates: same source file, multiple report numbers
    by_src = defaultdict(list)
    for r in rows:
        by_src[r["src"]].append(r)
    dupes = {s: rs for s, rs in by_src.items() if len(rs) > 1}

    print(f"\n=== COA PARSE-QUALITY AUDIT — {len(rows)} records ===")
    print(f"  clean (OK)        {sum(1 for r in rows if r['status']=='OK')}")
    print(f"  unresolved        {sum(1 for r in rows if r['status']=='UNRESOLVED')}")
    print(f"  low_confidence    {len(lowconf)}")
    print(f"  void              {sum(1 for r in rows if r['status']=='VOID')}")
    print(f"  ** zero analytes  {len(zero)} **")
    print(f"  no date           {len(nodate)}")
    print(f"  dup source files  {len(dupes)}")

    print("\n  BY LAB:")
    for lab, n in Counter(r["lab"] for r in rows).most_common():
        print(f"    {n:>3}  {lab}")

    if zero:
        print("\n=== ZERO-ANALYTE (half-baked) ===")
        for r in sorted(zero, key=lambda r: r["lab"]):
            print(f"  {r['lab'][:26]:<26} {r['src'][:50]}")

    if dupes:
        print("\n=== DUPLICATE SOURCE FILES (possible stale parses) ===")
        for s, rs in dupes.items():
            labs = ", ".join(f"{x['lab'][:12]}:{x['analytes']}a" for x in rs)
            print(f"  {s[:46]:<46} -> {labs}")

    if strict and zero:
        sys.exit(f"\nFAIL: {len(zero)} zero-analyte records")


if __name__ == "__main__":
    main()
