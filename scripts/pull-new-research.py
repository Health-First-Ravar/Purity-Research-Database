#!/usr/bin/env python3
"""Pull NEW research-paper PDFs from the research Drive folder into
knowledge-base/research/incoming/, extract text, and update the manifest.

Auth: Application Default Credentials (ADC) — Workload Identity Federation in CI
(no key file), or `gcloud auth application-default login` locally.

Flow:
  1. List every PDF under DRIVE_RESEARCH_FOLDER_ID (recurses one level into
     chapter subfolders if present).
  2. Skip files whose Drive md5 already appears in the manifest (no re-download).
  3. Download new PDFs into knowledge-base/research/incoming/<name>.pdf.
  4. Extract text to a sibling .txt (pymupdf) so `npm run ingest` can embed it.
  5. Append entries to knowledge-base/research/manifest.json.

Does NOT embed — the embedding step (npm run ingest) runs after this in CI.

Env:
  DRIVE_RESEARCH_FOLDER_ID   required
"""
from __future__ import annotations

import io
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import google.auth
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RESEARCH_DIR = ROOT / "knowledge-base" / "research"
INCOMING_DIR = RESEARCH_DIR / "incoming"
MANIFEST = RESEARCH_DIR / "manifest.json"

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
FOLDER_ID = os.environ.get("DRIVE_RESEARCH_FOLDER_ID")


def drive_client():
    creds, _ = google.auth.default(scopes=SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_children(drive, folder_id):
    """Return (pdfs, subfolders) directly under folder_id."""
    pdfs, folders, token = [], [], None
    q = f"'{folder_id}' in parents and trashed=false"
    while True:
        resp = drive.files().list(
            q=q,
            fields="nextPageToken, files(id,name,mimeType,md5Checksum)",
            pageSize=200, pageToken=token,
            supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute()
        for f in resp.get("files", []):
            if f.get("mimeType") == "application/vnd.google-apps.folder":
                folders.append(f)
            elif f.get("name", "").lower().endswith(".pdf"):
                pdfs.append(f)
        token = resp.get("nextPageToken")
        if not token:
            break
    return pdfs, folders


def all_pdfs(drive, folder_id):
    """PDFs in the folder and one level of chapter subfolders."""
    pdfs, folders = list_children(drive, folder_id)
    for sub in folders:
        sp, _ = list_children(drive, sub["id"])
        for f in sp:
            f["_chapter"] = sub["name"]
        pdfs.extend(sp)
    return pdfs


def download(drive, file_id, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    req = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
    dl = MediaIoBaseDownload(buf, req, chunksize=1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    dest.write_bytes(buf.getvalue())
    return buf.getvalue()


def pdf_to_text(data: bytes) -> str:
    try:
        import fitz  # pymupdf
        with fitz.open(stream=data, filetype="pdf") as doc:
            return "\n".join(p.get_text() for p in doc)
    except Exception:
        return ""


def main():
    if not FOLDER_ID:
        sys.exit("DRIVE_RESEARCH_FOLDER_ID not set")
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {
        "version": 1, "papers": []}
    known_ids = {p.get("fileId") for p in manifest.get("papers", [])}
    known_md5 = {p.get("drive_md5") for p in manifest.get("papers", []) if p.get("drive_md5")}

    drive = drive_client()
    pdfs = all_pdfs(drive, FOLDER_ID)

    counts = {"found": len(pdfs), "skipped": 0, "downloaded": 0, "failed": 0}
    for f in pdfs:
        fid, name = f["id"], f["name"]
        md5 = f.get("md5Checksum")
        if fid in known_ids or (md5 and md5 in known_md5):
            counts["skipped"] += 1
            continue
        try:
            stem = Path(name).stem
            dest = INCOMING_DIR / f"{stem}.pdf"
            data = download(drive, fid, dest)
            txt = pdf_to_text(data)
            if txt.strip():
                dest.with_suffix(".txt").write_text(txt)
            manifest["papers"].append({
                "fileId": fid,
                "chapter": f.get("_chapter", "incoming"),
                "shortname": stem,
                "title": stem,
                "drive_url": f"https://drive.google.com/file/d/{fid}/view",
                "drive_md5": md5,
                "pdf_path": str(dest.relative_to(RESEARCH_DIR)),
                "txt_path": str(dest.with_suffix(".txt").relative_to(RESEARCH_DIR)) if txt.strip() else None,
                "added": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            })
            counts["downloaded"] += 1
        except Exception as e:
            counts["failed"] += 1
            print(f"  FAILED {name}: {e}")

    manifest["count"] = len(manifest["papers"])
    manifest["last_research_sync"] = datetime.now(timezone.utc).isoformat()
    MANIFEST.write_text(json.dumps(manifest, indent=2))

    print("Research Drive sync summary")
    for k, v in counts.items():
        print(f"  {k:12} {v}")
    if counts["downloaded"] == 0 and counts["failed"] == 0:
        print("  (nothing new)")


if __name__ == "__main__":
    main()
