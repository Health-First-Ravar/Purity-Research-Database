#!/usr/bin/env python3
"""Audit Drive folder vs local /COAs/ vs the Supabase `coas` table.

Produces three outputs:
  logs/drive-coa-audit.csv       — every PDF in the Drive folder, columns:
                                     filename, drive_id, size_mb, year,
                                     likely_coa (yes/no/maybe),
                                     in_local_COAs, in_db
  logs/drive-coa-needs-pull.txt  — drive IDs of likely-COA files NOT yet in DB
  console                        — summary counts at each stage

Run from repo root:

  cd /Users/.../Purity-Lab-Data
  python3 scripts/audit-drive-vs-coas.py

Requires env vars (already set in dashboard/app/.env.local):
  DRIVE_COA_FOLDER_ID            — Drive folder ID for the COA library
  GOOGLE_SERVICE_ACCOUNT_JSON    — service-account JSON (string or filepath)
  NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY      — Supabase service-role key

The script auto-loads dashboard/app/.env.local so you don't have to export vars.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import Iterable

# ---------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "dashboard" / "app" / ".env.local"
COAS_LOCAL_DIR = ROOT / "COAs"
LOGS_DIR = ROOT / "logs"
CSV_OUT = LOGS_DIR / "drive-coa-audit.csv"
NEEDS_PULL_OUT = LOGS_DIR / "drive-coa-needs-pull.txt"

# Hard fallback: the folder ID Claude found by name. Overridden by env if set.
DEFAULT_FOLDER_ID = "13g6A4sSyYVfyfnkZtN59UEMZl7muuhhF"

# ---------------------------------------------------------------------------
# .env loader (no python-dotenv dependency)
# ---------------------------------------------------------------------------
def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        # don't clobber values already in real env
        if k and k not in os.environ:
            os.environ[k] = v


# ---------------------------------------------------------------------------
# COA filename heuristic
# ---------------------------------------------------------------------------
# Strong COA signals (any one match -> likely_coa=yes)
COA_STRONG = [
    re.compile(r"\bCOA\b", re.IGNORECASE),
    re.compile(r"\bC\.O\.A\.\b", re.IGNORECASE),
    re.compile(r"_COA(?:\W|$)", re.IGNORECASE),
    re.compile(r"^COA[-_]", re.IGNORECASE),
    re.compile(r"\bcertificate of analysis\b", re.IGNORECASE),
    re.compile(r"\bMXNS[-_]COA\b", re.IGNORECASE),
    re.compile(r"\bEurofins\b", re.IGNORECASE),
]

# Weak/maybe signals (the kind of lab-report-number filename Eurofins
# emits: 7-digit-dash-zero, sometimes with a (1) duplicate suffix)
COA_MAYBE = [
    re.compile(r"^\d{7,8}-0(?:_| |\(|\.)"),     # 4707694-0_COA or 4707694-0 (1)
    re.compile(r"_Report_\d{7,8}"),              # COA_Report_3864529-0
    re.compile(r"COA[-_].*\d{4}", re.IGNORECASE),
]

# Explicit non-COA signals (skip even if "COA" appears somewhere)
NON_COA_HINTS = [
    re.compile(r"coffee guide to (?:better|good) health", re.IGNORECASE),
    re.compile(r"\btax\s*form", re.IGNORECASE),
    re.compile(r"\bpacking[\s_]list\b", re.IGNORECASE),
    re.compile(r"\bwire transfer\b", re.IGNORECASE),
    re.compile(r"\btrilogy submission\b", re.IGNORECASE),
    re.compile(r"\binvoice\b", re.IGNORECASE),
    re.compile(r"\bbrand\b.*(?:guide|condensed)", re.IGNORECASE),
    re.compile(r"^s\d{5}-\d{3}-\d{5}", re.IGNORECASE),     # Springer paper ID
    re.compile(r"^\d+\.\d{4}/", re.IGNORECASE),            # DOI prefix
    re.compile(r"\bsciadv\b", re.IGNORECASE),
    re.compile(r"\bsustainability-\d+", re.IGNORECASE),
]


def classify(filename: str) -> str:
    """Return 'yes', 'maybe', or 'no' for whether this looks like a COA."""
    name = filename or ""
    if any(rx.search(name) for rx in NON_COA_HINTS):
        return "no"
    if any(rx.search(name) for rx in COA_STRONG):
        return "yes"
    if any(rx.search(name) for rx in COA_MAYBE):
        return "maybe"
    return "no"


# ---------------------------------------------------------------------------
# Drive client
# ---------------------------------------------------------------------------
def drive_client():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        raise SystemExit(
            "GOOGLE_SERVICE_ACCOUNT_JSON not set. Add it to dashboard/app/.env.local "
            "or export it in your shell."
        )
    if raw.strip().startswith("{"):
        creds_dict = json.loads(raw)
    else:
        creds_dict = json.loads(Path(raw).read_text(encoding="utf-8"))

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        raise SystemExit(
            "Missing Google libs. Install with:\n"
            "  pip3 install --break-system-packages "
            "google-api-python-client google-auth"
        )

    creds = service_account.Credentials.from_service_account_info(
        creds_dict,
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_folder_recursive(drive, folder_id: str) -> Iterable[dict]:
    """Yield every PDF in the folder and any subfolders, recursively."""
    page_token = None
    subfolders: list[str] = []
    while True:
        resp = drive.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields=(
                "nextPageToken, files(id, name, mimeType, size, "
                "createdTime, modifiedTime, parents, md5Checksum)"
            ),
            pageSize=200,
            pageToken=page_token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        for f in resp.get("files", []):
            mt = f.get("mimeType", "")
            if mt == "application/vnd.google-apps.folder":
                subfolders.append(f["id"])
                continue
            if mt == "application/pdf" or f.get("name", "").lower().endswith(".pdf"):
                yield f
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    for sub in subfolders:
        yield from list_folder_recursive(drive, sub)


# ---------------------------------------------------------------------------
# Supabase client
# ---------------------------------------------------------------------------
def db_known_filenames() -> set[str]:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(
            "Supabase env vars missing. Need NEXT_PUBLIC_SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY in dashboard/app/.env.local."
        )
    try:
        from supabase import create_client
    except ImportError:
        raise SystemExit(
            "supabase library missing. Install with:\n"
            "  pip3 install --break-system-packages supabase"
        )
    sb = create_client(url, key)

    # Page through every row — supabase-py caps at 1000 per call.
    out: set[str] = set()
    page = 0
    while True:
        start = page * 1000
        end = start + 999
        resp = (
            sb.table("coas")
            .select("pdf_filename")
            .range(start, end)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            break
        for r in rows:
            fn = r.get("pdf_filename")
            if fn:
                out.add(fn.strip())
        if len(rows) < 1000:
            break
        page += 1
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    load_env(ENV_FILE)
    folder_id = os.environ.get("DRIVE_COA_FOLDER_ID") or DEFAULT_FOLDER_ID
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[audit] folder_id    = {folder_id}")
    print(f"[audit] local /COAs  = {COAS_LOCAL_DIR}")
    print(f"[audit] env loaded   = {ENV_FILE if ENV_FILE.exists() else '(none)'}")
    print()

    print("[audit] listing local /COAs ...")
    local_filenames = {p.name for p in COAS_LOCAL_DIR.glob("*.pdf")} \
        | {p.name for p in COAS_LOCAL_DIR.glob("*.PDF")}
    print(f"        {len(local_filenames)} PDFs locally")

    print("[audit] querying Supabase `coas` table ...")
    db_filenames = db_known_filenames()
    print(f"        {len(db_filenames)} non-null pdf_filename values in DB")
    print()

    print("[audit] listing Drive folder (recursive) ...")
    drive = drive_client()
    rows: list[dict] = []
    for f in list_folder_recursive(drive, folder_id):
        name = f.get("name", "")
        size_b = int(f.get("size") or 0)
        created = f.get("createdTime", "")
        year = created[:4] if created else ""
        cls = classify(name)
        rows.append({
            "filename": name,
            "drive_id": f.get("id", ""),
            "size_mb": round(size_b / (1024 * 1024), 2),
            "year": year,
            "likely_coa": cls,
            "in_local_COAs": "yes" if name in local_filenames else "no",
            "in_db": "yes" if name in db_filenames else "no",
        })
    print(f"        {len(rows)} PDFs in Drive folder (incl. subfolders)")
    print()

    # write CSV
    with CSV_OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "filename", "drive_id", "size_mb", "year",
            "likely_coa", "in_local_COAs", "in_db",
        ])
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: (r["likely_coa"] != "yes", r["filename"])))
    print(f"[audit] wrote {CSV_OUT}")

    # write needs-pull list
    needs_pull = [r for r in rows if r["likely_coa"] == "yes" and r["in_db"] == "no"]
    with NEEDS_PULL_OUT.open("w", encoding="utf-8") as fh:
        fh.write(f"# {len(needs_pull)} likely-COA files in Drive but NOT in DB\n")
        fh.write("# format: <drive_id>\t<filename>\n")
        for r in needs_pull:
            fh.write(f"{r['drive_id']}\t{r['filename']}\n")
    print(f"[audit] wrote {NEEDS_PULL_OUT}")
    print()

    # console summary
    n_total = len(rows)
    n_yes = sum(1 for r in rows if r["likely_coa"] == "yes")
    n_maybe = sum(1 for r in rows if r["likely_coa"] == "maybe")
    n_no = sum(1 for r in rows if r["likely_coa"] == "no")
    n_local = sum(1 for r in rows if r["in_local_COAs"] == "yes")
    n_db = sum(1 for r in rows if r["in_db"] == "yes")
    n_coa_in_db = sum(1 for r in rows if r["likely_coa"] == "yes" and r["in_db"] == "yes")
    n_coa_missing = sum(1 for r in rows if r["likely_coa"] == "yes" and r["in_db"] == "no")

    print("=" * 60)
    print(" AUDIT SUMMARY")
    print("=" * 60)
    print(f"  PDFs in Drive folder (recursive): {n_total}")
    print(f"    likely COA  : {n_yes}")
    print(f"    maybe COA   : {n_maybe}  ← review by hand")
    print(f"    not a COA   : {n_no}")
    print()
    print(f"  Local /COAs/ matches:    {n_local}")
    print(f"  DB pdf_filename matches: {n_db}")
    print()
    print(f"  ✓ likely-COA already in DB:    {n_coa_in_db}")
    print(f"  ✗ likely-COA MISSING from DB:  {n_coa_missing}  ← the gap")
    print()
    print(f"  Next step: review {CSV_OUT.relative_to(ROOT)}")
    print(f"             then run the pull script against {NEEDS_PULL_OUT.relative_to(ROOT)}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
