#!/usr/bin/env python3
"""
Rebuild index.json from every Processed/*.json COA.

Run from the Purity-Lab-Data repo root (where all files are local/hydrated):

    python3 scripts/rebuild_index.py
    python3 scripts/rebuild_index.py --processed Processed --out index.json

One Processed JSON == one report == one sample (the live schema is flat:
report_number, test_date, sample_name, lab, status, product_key, matrix,
superseded_by, analytes[]). The script also tolerates the older nested
{"samples":[...]} shape if any remain.

It SKIPS files that don't look like a report (no report id) and prints them so
you can deal with hex-named junk (e.g. 9c9598cf36f8c8dd.json) separately.
"""
import json, glob, os, re, argparse, datetime

def lab_detected(report_id, lab):
    rid = (report_id or "")
    if rid.startswith(("CHG-", "BRN-")):
        return "silliker"
    if rid.startswith("RESEARCH-"):
        return "research"
    low = (lab or "").lower()
    if "eurofins" in low:
        return "eurofins"
    if "silliker" in low or "merieux" in low or "nutrisci" in low:
        return "silliker"
    if "trugo" in low or "farah" in low:
        return "research"
    if re.match(r"^\d{6,}-\d", rid):
        return "eurofins"
    return "unknown"

def report_id_of(d):
    return d.get("report_number") or d.get("report_id")

def entry_from(d, path):
    rid = report_id_of(d)
    samples = d.get("samples")
    if isinstance(samples, list) and samples:
        sample_count = len(samples)
        product_names = sorted({s.get("product_canonical") or s.get("product_key")
                                for s in samples if s.get("product_canonical") or s.get("product_key")})
        analyte_count = sum(len(s.get("analytes", [])) for s in samples)
    else:
        sample_count = 1
        pk = d.get("product_key")
        product_names = [pk] if pk else []
        analyte_count = len(d.get("analytes", []))
    superseded_by = d.get("superseded_by")
    return {
        "report_id": rid,
        "report_status": "VOID" if superseded_by else "ACTIVE",
        "superseded_by": superseded_by,
        "report_date": d.get("test_date") or d.get("report_date"),
        "lab": d.get("lab"),
        "lab_detected": lab_detected(rid, d.get("lab")),
        "matrix": d.get("matrix"),
        "client": "Purity Coffee",
        "source_file_name": os.path.basename(d.get("source_file", "")) or None,
        "drive_file_id": None,  # not known from local filesystem; filled by the Drive sync step if used
        "sample_count": sample_count,
        "analyte_count": analyte_count,
        "product_names": product_names,
        "ingested_at": d.get("ingested_at"),
        "_local_path": os.path.relpath(path),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--processed", default="Processed")
    ap.add_argument("--out", default="index.json")
    a = ap.parse_args()

    entries, skipped = [], []
    for path in sorted(glob.glob(os.path.join(a.processed, "*.json"))):
        base = os.path.basename(path)
        if base == "index.json" or base.startswith("_"):
            continue
        try:
            d = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            skipped.append((base, f"unreadable: {e}"))
            continue
        if not report_id_of(d):
            skipped.append((base, "no report id (likely junk)"))
            continue
        entries.append(entry_from(d, path))

    # newest first; undated sort last
    entries.sort(key=lambda e: (e["report_date"] or ""), reverse=True)

    index = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "total_reports": len(entries),
        "reports": entries,
    }
    json.dump(index, open(a.out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    print(f"Wrote {a.out}: {len(entries)} reports")
    by_lab = {}
    for e in entries:
        by_lab[e["lab_detected"]] = by_lab.get(e["lab_detected"], 0) + 1
    print("  by lab_detected:", dict(sorted(by_lab.items())))
    voids = [e["report_id"] for e in entries if e["report_status"] == "VOID"]
    if voids:
        print(f"  VOID/superseded: {len(voids)} -> {voids}")
    if skipped:
        print(f"  SKIPPED {len(skipped)} non-report files:")
        for name, why in skipped:
            print(f"    - {name}: {why}")

if __name__ == "__main__":
    main()
