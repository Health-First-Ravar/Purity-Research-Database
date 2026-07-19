#!/usr/bin/env python3
"""Pull NEW COA documents (PDF and Word) from the live Drive folder into COAs/.

Auth: Application Default Credentials (ADC).
  - In GitHub Actions: provided by google-github-actions/auth (Workload Identity
    Federation) — no key file.
  - Locally: run `gcloud auth application-default login` once.

Behavior:
  1. Walk DRIVE_COA_FOLDER_ID recursively for PDFs and .docx, skipping the
     folders named in SKIP_FOLDERS. Current lab work is filed both in the base
     folder and in subfolders (Reese and others use Processed/), so a
     non-recursive listing misses live COAs.
  2. Classify COA vs not-COA (filename + first-page text fingerprint).
  3. Skip filenames already present in COAs/.
  4. Download missing COAs into COAs/. Quarantine non-COAs into _NotCOA/.
  5. Write logs/coa-sync-<date>.json manifest and print a summary.

Does NOT parse or touch the database — ingest.py + import-coas handle that next.

Env:
  DRIVE_COA_FOLDER_ID   required
"""
from __future__ import annotations

import hashlib
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


# Mime types we fetch.
#
# ingest.py accepts {".pdf", ".docx"} and lib_extract parses .docx with
# python-docx, but this puller only ever asked Drive for PDFs — so 22 COA-like
# Word documents at the top level were never downloaded, and the only Word
# COAs in the corpus got there because a human copied them in by hand.
#
# Legacy .doc (application/msword) is deliberately NOT fetched: python-docx
# cannot read the old binary format, so ingest.py would skip the file and it
# would sit in COAs/ as clutter. Such files are reported at the end of the run
# instead, so they are visible rather than silently absent.
MIME_PDF = "application/pdf"
MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MIME_DOC_LEGACY = "application/msword"
FETCH_MIMES = (MIME_PDF, MIME_DOCX)


# Subfolders NOT walked.
#
# "Lost files" is human tidying — book manuscripts, Sacred Cups material and
# admin documents the classifier already blocks. Walking it would download tens
# of megabytes of material only to quarantine it.
SKIP_FOLDERS = {"Lost files"}


def list_documents(drive, folder_id):
    """Recursive walk. Returns files tagged with the folder path they came from."""
    mime_clause = " or ".join(f"mimeType='{m}'" for m in FETCH_MIMES)
    out = []

    def walk(fid, path):
        token = None
        while True:
            resp = (
                drive.files()
                .list(
                    q=f"'{fid}' in parents and ({mime_clause}) and trashed=false",
                    fields="nextPageToken, files(id,name,size,md5Checksum,mimeType)",
                    pageSize=200,
                    pageToken=token,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                )
                .execute()
            )
            for f in resp.get("files", []):
                f["_folder"] = path
                out.append(f)
            token = resp.get("nextPageToken")
            if not token:
                break
        token = None
        while True:
            resp = (
                drive.files()
                .list(
                    q=f"'{fid}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
                    fields="nextPageToken, files(id,name)",
                    pageSize=200,
                    pageToken=token,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                )
                .execute()
            )
            for d in resp.get("files", []):
                if d["name"] in SKIP_FOLDERS:
                    print(f"  skipping folder (excluded): {d['name']}")
                    continue
                walk(d["id"], f"{path}/{d['name']}" if path else d["name"])
            token = resp.get("nextPageToken")
            if not token:
                break

    walk(folder_id, "")
    return out


def _unused_flat_listing(drive, folder_id):
    files, token = [], None
    mime_clause = " or ".join(f"mimeType='{m}'" for m in FETCH_MIMES)
    q = f"'{folder_id}' in parents and ({mime_clause}) and trashed=false"
    while True:
        resp = (
            drive.files()
            .list(
                q=q,
                fields="nextPageToken, files(id,name,size,md5Checksum,mimeType)",
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


def first_page_text(drive, file_id, mime=MIME_PDF) -> str:
    """First-page/opening text for the ambiguous-filename check.

    Word documents need a different reader; without this branch every
    ambiguous .docx would fall through to "" and be quarantined as not-a-COA
    purely because fitz cannot open it.
    """
    if mime == MIME_DOCX:
        try:
            buf = io.BytesIO()
            req = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
            dl = MediaIoBaseDownload(buf, req, chunksize=1024 * 1024)
            done = False
            while not done:
                _, done = dl.next_chunk()
            import docx  # python-docx

            buf.seek(0)
            d = docx.Document(buf)
            return "\n".join(p.text for p in d.paragraphs[:60])
        except Exception:
            return ""
    return _first_page_text_pdf(drive, file_id)


def _first_page_text_pdf(drive, file_id) -> str:
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
    txt = first_page_text(drive, f["id"], f.get("mimeType", MIME_PDF))
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
    # Skip anything already pulled, INCLUDING quarantined files. Without the
    # _NotCOA/ half, moving a bad file out of COAs/ is undone on the next run:
    # the file is re-downloaded, re-parsed, and fails again. That is how one
    # 3-byte non-PDF kept ingest.py's error count at 1 and stopped
    # last_successful_sync from ever advancing.
    def _local(d):
        return [p for p in d.glob("*") if p.suffix.lower() in {".pdf", ".docx"}] if d.exists() else []

    local_files = _local(COAS_DIR) + _local(NOTCOA_DIR)
    existing = {p.name for p in local_files}

    # Content index. Drive's md5Checksum lets us recognise a file we already
    # hold even when it arrives under a different name or from another folder,
    # so recursion cannot re-download the same document twice.
    def _md5(path: Path) -> str:
        h = hashlib.md5()
        with path.open("rb") as fh:
            for block in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(block)
        return h.hexdigest()

    existing_md5 = {}
    for p in local_files:
        try:
            existing_md5[_md5(p)] = p.name
        except Exception:
            pass

    drive = drive_client()
    files = list_documents(drive, FOLDER_ID)

    # Legacy .doc cannot be parsed by python-docx, so it is not fetched. Report
    # it so an unreadable-but-present COA is a visible gap, not a silent one.
    legacy = drive.files().list(
        q=f"'{FOLDER_ID}' in parents and mimeType='{MIME_DOC_LEGACY}' and trashed=false",
        fields="files(name)", pageSize=100,
        supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute().get("files", [])

    manifest = {"run": datetime.now(timezone.utc).isoformat(), "items": []}
    counts = {"found": len(files), "skipped_existing": 0, "downloaded": 0,
              "downloaded_pdf": 0, "downloaded_docx": 0,
              "skipped_same_content": 0, "name_conflicts": 0,
              "quarantined": 0, "failed": 0}

    # Resolve same-name collisions across folders BEFORE downloading.
    #
    # Rule: deduplicate on content hash, never on filename.
    #   same name + same md5  -> one document filed twice; take the base-folder
    #                            copy, which is where current lab work lands.
    #   same name + diff md5  -> genuinely different documents. Both would parse
    #                            to the same report_number, and import-coas
    #                            matches on that, so ingesting the second would
    #                            OVERWRITE the first and last-write would win.
    #                            Take the base copy and REPORT the other rather
    #                            than silently choosing.
    by_name = {}
    for f in files:
        by_name.setdefault(f["name"], []).append(f)
    conflicts = []
    chosen = []
    for name, group in by_name.items():
        if len(group) == 1:
            chosen.append(group[0])
            continue
        hashes = {g.get("md5Checksum") for g in group}
        group.sort(key=lambda g: (g.get("_folder") or ""))  # base folder ("") first
        chosen.append(group[0])
        if len(hashes) > 1:
            conflicts.append({"name": name, "taken": group[0].get("_folder") or "(base)",
                              "copies": [{"folder": g.get("_folder") or "(base)",
                                          "size": g.get("size"),
                                          "md5": g.get("md5Checksum")} for g in group]})
    counts["name_conflicts"] = len(conflicts)
    files = chosen

    for f in files:
        name, fid = f["name"], f["id"]
        if name in existing:
            counts["skipped_existing"] += 1
            continue
        if f.get("md5Checksum") and f["md5Checksum"] in existing_md5:
            counts["skipped_same_content"] += 1
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
                counts["downloaded_docx" if f.get("mimeType") == MIME_DOCX else "downloaded_pdf"] += 1
                status = "downloaded"
        except Exception as e:
            counts["failed"] += 1
            status = f"failed: {e}"
        manifest["items"].append({"name": name, "id": fid, "status": status,
                                  "folder": f.get("_folder") or "(base)"})

    LOGS_DIR.mkdir(exist_ok=True)
    out = LOGS_DIR / f"coa-sync-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.json"
    manifest["counts"] = counts
    manifest["name_conflicts"] = conflicts
    out.write_text(json.dumps(manifest, indent=2))

    print("COA Drive sync summary")
    for k, v in counts.items():
        print(f"  {k:18} {v}")
    print(f"  manifest -> {out.relative_to(ROOT)}")
    if conflicts:
        print(f"  NAME CONFLICTS ({len(conflicts)}) — same filename, DIFFERENT content.")
        print("    Took the base-folder copy; the other is NOT ingested. Inspect manually:")
        for c in conflicts:
            print(f"      {c['name']}")
            for cp in c["copies"]:
                print(f"         {cp['folder']:<12} {str(cp['size']):>9} B  md5={str(cp['md5'])[:12]}")
    if legacy:
        print(f"  NOTE: {len(legacy)} legacy .doc file(s) NOT fetched "
              f"(python-docx cannot read the old binary format):")
        for l in legacy:
            print(f"          {l['name']}")
    if counts["downloaded"] == 0 and counts["failed"] == 0:
        print("  (nothing new)")


if __name__ == "__main__":
    main()
