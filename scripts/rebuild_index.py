#!/usr/bin/env python3
"""Rebuild index.json from every Processed/*.json COA. Run from repo root."""
import json, glob, os, re, argparse, datetime

def lab_detected(rid, lab):
    rid = rid or ""
    if rid.startswith(("CHG-", "BRN-")): return "silliker"
    if rid.startswith("RESEARCH-"): return "research"
    low = (lab or "").lower()
    if "eurofins" in low: return "eurofins"
    if "silliker" in low or "merieux" in low or "nutrisci" in low: return "silliker"
    if "trugo" in low or "farah" in low: return "research"
    if re.match(r"^\d{6,}-\d", rid): return "eurofins"
    return "unknown"

def rid_of(d): return d.get("report_number") or d.get("report_id")

def entry_from(d, path):
    rid = rid_of(d)
    samples = d.get("samples")
    if isinstance(samples, list) and samples:
        sc = len(samples)
        pn = sorted({s.get("product_canonical") or s.get("product_key")
                     for s in samples if s.get("product_canonical") or s.get("product_key")})
        ac = sum(len(s.get("analytes", [])) for s in samples)
    else:
        sc = 1
        pk = d.get("product_key"); pn = [pk] if pk else []
        ac = len(d.get("analytes", []))
    sb = d.get("superseded_by")
    return {"report_id": rid, "report_status": "VOID" if sb else "ACTIVE",
            "superseded_by": sb, "report_date": d.get("test_date") or d.get("report_date"),
            "lab": d.get("lab"), "lab_detected": lab_detected(rid, d.get("lab")),
            "matrix": d.get("matrix"), "client": "Purity Coffee",
            "source_file_name": os.path.basename(d.get("source_file", "")) or None,
            "drive_file_id": None, "sample_count": sc, "analyte_count": ac,
            "product_names": pn, "ingested_at": d.get("ingested_at"),
            "_local_path": os.path.relpath(path)}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--processed", default="Processed")
    ap.add_argument("--out", default="index.json")
    a = ap.parse_args()
    entries, skipped = [], []
    for path in sorted(glob.glob(os.path.join(a.processed, "*.json"))):
        base = os.path.basename(path)
        if base == "index.json" or base.startswith("_"): continue
        try: d = json.load(open(path, encoding="utf-8"))
        except Exception as e: skipped.append((base, f"unreadable: {e}")); continue
        if not rid_of(d): skipped.append((base, "no report id (likely junk)")); continue
        entries.append(entry_from(d, path))
    entries.sort(key=lambda e: (e["report_date"] or ""), reverse=True)
    idx = {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "total_reports": len(entries), "reports": entries}
    json.dump(idx, open(a.out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"Wrote {a.out}: {len(entries)} reports")
    by = {}
    for e in entries: by[e["lab_detected"]] = by.get(e["lab_detected"], 0) + 1
    print("  by lab_detected:", dict(sorted(by.items())))
    if skipped:
        print(f"  SKIPPED {len(skipped)}:")
        for n, w in skipped: print(f"    - {n}: {w}")

if __name__ == "__main__":
    main()
