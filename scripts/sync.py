#!/usr/bin/env python3
"""Scheduled sync — runs 2x daily via Cowork scheduled task.

Incremental (not --force). Re-ingests only files whose hash changed or that
aren't yet in the index. Then rebuilds any affected product synthesis docs.

Writes last_successful_sync on clean completion. If the scheduled task fails
silently, last_successful_sync will not advance — the skill surfaces a
staleness warning after 36h of no successful sync.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> int:
    rc = subprocess.run([sys.executable, str(HERE / "ingest.py")], cwd=str(HERE)).returncode
    rc2 = subprocess.run([sys.executable, str(HERE / "synthesize.py")], cwd=str(HERE)).returncode
    return rc or rc2


if __name__ == "__main__":
    sys.exit(main())
