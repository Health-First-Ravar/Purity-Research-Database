#!/usr/bin/env python3
"""Pull NEW COA PDFs from the live Drive folder into COAs/.

Auth: Application Default Credentials (ADC).
  - In GitHub Actions: provided by google-github-actions/auth (Workload Identity
    Federation) — no key file.
  - Locally: run `gcloud auth application-default login` once.

Behavior:
  1. List every PDF under DRIVE_COA_FOLDER_ID.
  2. Classify COA vs not-COA (filename + first-page text fingerprint).
  3. Skip filenames already present in COAs/.
  4. Download missing COAs into COAs/. Quarantine non-COAs into _NotCOA/.
  5. Write logs/coa-sync-<date>.json manifest and print a summary.

Does NOT parse or touch the database — ingest.py + import-coas handle that next.

Env:
  DRIVE_COA_FOLDER_ID   required
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import google.auth
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
COAS_DIR = ROOT / "COAs"
NOTCOA_DIR = ROOT / "_NotCOA"
LOGS_DIR = ROOT / "logs"

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
FOLDER_ID = os.environ.get("DRIVE_COA_FOLDER_ID")

# --- Classification --------------------------------------------------------
NOT_COA_FILENAME = re.compile(
    r"(^s\d{4,5}-|sciadv|^Ray-2013|Saraiva|schubert|sustainability_assessment|"
    r"Coffee Guide|Sacred Cups|tax|Packing.?List|WIRE TRANSFER|Trilogy|"
    r"Green Coffee samples|Offer Sample|PSS\b|"
    # Branding sheets and cover letters are not COAs even though their names
    # contain "COA" / "CLOROGÉNICO". Checked before COA_FILENAME below.
    r"branding|\bcarta\b)",
    re.IGNORECASE,
)
COA_FILENAME = re.compile(
    r"(COA|\b\d{6,8}-\d\b|Contaminants|Nutrition|Nutition|Caffeine|CGA|"
    r"Trigonelline|[ÁA]CIDO\s+CLOROG[ÉE]NICO|CLOROG[ÉE]NICO|informe)",
    re.IGNORECASE,
)
COA_TEXT = re.compile(
    r"(certificate of analysis|ochratoxin|aflatoxin|mycotoxin|chlorogenic|"
    r"clorog[ée]nico|crom\s*-?\s*mass|universidad industrial de santander|"
    r"informe de (?:ensayo|resultados)|trilogy|"
    r"acrylamide|water activity|sample id|report number|eurofins|m[ée]todo|method of analysis)",
    re.IGNORECASE,
)


def drive_client():
    creds, _ = google.auth.default(scopes=SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_pdfs(drive, folder_id):
    files, token = [], None
    q = f"'{folder_id}' in parents and mimeType='application/pdf' and trashed=false"
    while True:
        resp = (
            drive.files()
            .list(
                q=q,
                fields="nextPageToken, files(id,name,size,md5Checksum)",
                pageSize=200,
                pageToken=token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
        files.extend(resp.get("files", []))
        token = resp.get("nextPageToken")
        if not token:
            break
    return files


def first_page_text(drive, file_id) -> str:
    try:
        buf = io.BytesIO()
        req = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
        dl = MediaIoBaseDownload(buf, req, chunksize=256 * 1024)
        done = False
        while not done and buf.tell() < 512 * 1024:
            _, done = dl.next_chunk()
        import fitz  # pymupdf

        with fitz.open(stream=buf.getvalue(), filetype="pdf") as doc:
            return doc[0].get_text() if doc.page_count else ""
    except Exception:
        return ""


def classify(drive, f) -> str:
    name = f["name"]
    if NOT_COA_FILENAME.search(name):
        return "not_coa"
    if COA_FILENAME.search(name):
        return "coa"
    txt = first_page_text(drive, f["id"])
    return "coa" if COA_TEXT.search(txt) else "not_coa"


def download(drive, file_id, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    req = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
    dl = MediaIoBaseDownload(buf, req, chunksize=1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    dest.write_bytes(buf.getvalue())


def main():
    if not FOLDER_ID:
        sys.exit("DRIVE_COA_FOLDER_ID not set")
    COAS_DIR.mkdir(exist_ok=True)
    existing = {p.name for p in COAS_DIR.glob("*.pdf")}

    drive = drive_client()
    files = list_pdfs(drive, FOLDER_ID)

    manifest = {"run": datetime.now(timezone.utc).isoformat(), "items": []}
    counts = {"found": len(files), "skipped_existing": 0, "downloaded": 0,
              "quarantined": 0, "failed": 0}

    for f in files:
        name, fid = f["name"], f["id"]
        if name in existing:
            counts["skipped_existing"] += 1
            continue
        try:
            kind = classify(drive, f)
            if kind == "not_coa":
                download(drive, fid, NOTCOA_DIR / name)
                counts["quarantined"] += 1
                status = "quarantined"
            else:
                download(drive, fid, COAS_DIR / name)
                counts["downloaded"] += 1
                status = "downloaded"
        except Exception as e:
            counts["failed"] += 1
            status = f"failed: {e}"
        manifest["items"].append({"name": name, "id": fid, "status": status})

    LOGS_DIR.mkdir(exist_ok=True)
    out = LOGS_DIR / f"coa-sync-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.json"
    manifest["counts"] = counts
    out.write_text(json.dumps(manifest, indent=2))

    print("COA Drive sync summary")
    for k, v in counts.items():
        print(f"  {k:18} {v}")
    print(f"  manifest -> {out.relative_to(ROOT)}")
    if counts["downloaded"] == 0 and counts["failed"] == 0:
        print("  (nothing new)")


if __name__ == "__main__":
    main()
