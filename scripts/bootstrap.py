#!/usr/bin/env python3
"""Bootstrap — one-time batch ingestion of the entire COA library.

Run this ONCE before activating the skill. Do not rely on the skill's
on-open check to process a large initial library (Myco review: that path
will time out mid-session). After bootstrap, verify index.json is complete
and only then expose the skill to CS reps.

Sequence:
  1. ingest.py --force        (reprocess everything, regardless of cached hashes)
  2. synthesize.py            (rebuild all product synthesis docs)
  3. print summary + any UNRESOLVED samples the owner needs to map
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
INDEX_PATH = ROOT / "index.json"


def run(cmd: list[str]) -> int:
    print(f"\n$ {' '.join(cmd)}")
    r = subprocess.run(cmd, cwd=str(HERE))
    return r.returncode


def main() -> int:
    rc = run([sys.executable, str(HERE / "ingest.py"), "--force"])
    if rc != 0:
        print(f"Ingest exited with code {rc}. Check /logs/ and index.json.last_sync_error.",
              file=sys.stderr)
    rc2 = run([sys.executable, str(HERE / "synthesize.py")])
    if rc2 != 0:
        print(f"Synthesize exited with code {rc2}.", file=sys.stderr)

    # Summary
    if INDEX_PATH.exists():
        idx = json.loads(INDEX_PATH.read_text())
        files = idx.get("files", {})
        status_counts: dict[str, int] = {}
        for meta in files.values():
            status_counts[meta.get("status", "?")] = status_counts.get(meta.get("status", "?"), 0) + 1
        unresolved = idx.get("unresolved_samples", [])
        low_conf = idx.get("low_confidence_parses", [])
        void = idx.get("void_reports", [])

        print("\n=== Bootstrap summary ===")
        print(f"  total files in index: {len(files)}")
        for s, n in sorted(status_counts.items()):
            print(f"    {s}: {n}")
        print(f"  void reports (superseded): {len(void)}")
        print(f"  unresolved samples:        {len(unresolved)}")
        print(f"  low-confidence parses:     {len(low_conf)}")
        if unresolved:
            print("\n  Unresolved — the owner should add these to product-map.json:")
            for u in unresolved:
                print(f"    - {u.get('sample_name')!r}  lot={u.get('lot_or_po')!r}  file={u.get('file')}")
        print(f"\n  last_successful_sync: {idx.get('last_successful_sync')}")
    return rc or rc2


if __name__ == "__main__":
    sys.exit(main())
