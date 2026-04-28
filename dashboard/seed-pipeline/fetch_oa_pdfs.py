#!/usr/bin/env python3
"""Fetch, extract, chunk, embed, and ingest the open-access subset of the
448-article bibliography into pgvector.

Targets: sources rows where
  rights_download IN ('Yes - Open Access', 'Yes - Free via PMC', 'Yes - Free access')
  AND has_pdf = false
  AND doi IS NOT NULL

Resolution order per DOI:
  1. NCBI ID Converter → PMCID → PMC PDF  (https://pmc.ncbi.nlm.nih.gov/articles/PMC{id}/pdf/)
  2. Unpaywall → best_oa_location.url_for_pdf
  3. Skip (log in unresolved.jsonl)

Usage:
  python fetch_oa_pdfs.py                     # fetch + ingest
  python fetch_oa_pdfs.py --limit 10          # first 10 rows only
  python fetch_oa_pdfs.py --dry-run           # resolve URLs, don't download
  python fetch_oa_pdfs.py --only-resolve      # just resolve → oa_manifest.jsonl

Env:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  VOYAGE_API_KEY
  UNPAYWALL_EMAIL
  NCBI_API_KEY                  (optional; raises rate limit 3→10/s)
  BIBLIOGRAPHY_PDF_ROOT         (optional; default under knowledge-base/bibliography/pdfs)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import requests
import voyageai
from dotenv import load_dotenv
from supabase import Client, create_client
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OA_RIGHTS = ('Yes - Open Access', 'Yes - Free via PMC', 'Yes - Free access')
DEFAULT_PDF_ROOT = Path(
    '/sessions/confident-sweet-brahmagupta/mnt/Purity-Lab-Data/knowledge-base/bibliography/pdfs'
)
USER_AGENT = 'purity-dashboard-oa-fetch/0.1 (mailto:jravar@puritycoffee.com)'
EMBED_MODEL = 'voyage-3-large'
EMBED_DIMS = 1024
EMBED_BATCH = 32
CHUNK_MAX_CHARS = 4000     # ~1000 tokens
CHUNK_OVERLAP_CHARS = 500
PDF_TIMEOUT = 45
PDFTOTEXT_TIMEOUT = 90


# ---------------------------------------------------------------------------
# Resolvers
# ---------------------------------------------------------------------------

@dataclass
class Resolution:
    doi: str
    pdf_url: str | None = None
    resolver: str | None = None   # 'pmc' | 'unpaywall' | 'pmc_direct'
    pmcid: str | None = None
    notes: list[str] = field(default_factory=list)


def _sleep(secs: float) -> None:
    if secs > 0:
        time.sleep(secs)


def resolve_pmcid(doi: str, session: requests.Session, api_key: str | None) -> str | None:
    """NCBI ID Converter: DOI → PMCID."""
    params = {
        'tool': 'purity-dashboard',
        'email': os.environ.get('UNPAYWALL_EMAIL', 'research@example.org'),
        'ids': doi,
        'format': 'json',
    }
    if api_key:
        params['api_key'] = api_key
    try:
        r = session.get(
            'https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/',
            params=params, timeout=15,
        )
        if r.status_code != 200:
            return None
        j = r.json()
        records = j.get('records', [])
        if not records:
            return None
        pmcid = records[0].get('pmcid')
        if pmcid and pmcid.upper().startswith('PMC'):
            return pmcid.upper()
    except Exception:
        return None
    return None


def resolve_via_pmc(doi: str, session: requests.Session, api_key: str | None) -> Resolution:
    pmcid = resolve_pmcid(doi, session, api_key)
    res = Resolution(doi=doi, pmcid=pmcid)
    if not pmcid:
        res.notes.append('no PMCID')
        return res
    numeric = re.sub(r'[^0-9]', '', pmcid)
    # Primary: PMC Open Access service (returns direct PDF URL)
    try:
        r = session.get(
            'https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi',
            params={'id': pmcid}, timeout=15,
        )
        if r.ok and '<link' in r.text:
            # <link format="pdf" href="ftp://ftp.ncbi.nlm.nih.gov/..."> or https
            m = re.search(r'format="pdf"\s+href="([^"]+)"', r.text)
            if m:
                url = m.group(1).replace('ftp://ftp.ncbi.nlm.nih.gov/', 'https://ftp.ncbi.nlm.nih.gov/')
                res.pdf_url = url
                res.resolver = 'pmc'
                return res
    except Exception as e:
        res.notes.append(f'oa.fcgi error: {e}')
    # Fallback: direct URL (works for many recent OA papers)
    res.pdf_url = f'https://pmc.ncbi.nlm.nih.gov/articles/PMC{numeric}/pdf/'
    res.resolver = 'pmc_direct'
    return res


def resolve_via_unpaywall(doi: str, session: requests.Session, email: str) -> Resolution:
    res = Resolution(doi=doi)
    try:
        r = session.get(
            f'https://api.unpaywall.org/v2/{doi}',
            params={'email': email}, timeout=15,
        )
        if r.status_code == 404:
            res.notes.append('unpaywall 404')
            return res
        if not r.ok:
            res.notes.append(f'unpaywall {r.status_code}')
            return res
        j = r.json()
        best = j.get('best_oa_location') or {}
        url = best.get('url_for_pdf') or best.get('url')
        if url and url.lower().endswith('.pdf'):
            res.pdf_url = url
            res.resolver = 'unpaywall'
            return res
        # Sometimes url_for_pdf is a landing page; try it anyway
        if url:
            res.pdf_url = url
            res.resolver = 'unpaywall'
            res.notes.append('landing-page URL, not a direct PDF')
            return res
    except Exception as e:
        res.notes.append(f'unpaywall error: {e}')
    return res


# ---------------------------------------------------------------------------
# Download + extract
# ---------------------------------------------------------------------------

def download_pdf(url: str, session: requests.Session) -> bytes | None:
    try:
        r = session.get(url, timeout=PDF_TIMEOUT, allow_redirects=True, stream=True)
    except Exception:
        return None
    if not r.ok:
        return None
    ct = r.headers.get('content-type', '').lower()
    # Some redirects end at an HTML landing page; require PDF content type OR PDF magic bytes
    head = next(r.iter_content(chunk_size=1024), b'') or b''
    if b'%PDF' not in head[:8] and 'pdf' not in ct:
        return None
    chunks = [head]
    for chunk in r.iter_content(chunk_size=65536):
        chunks.append(chunk)
    return b''.join(chunks)


def slugify_doi(doi: str) -> str:
    s = re.sub(r'[^A-Za-z0-9._-]+', '-', doi)
    return s.strip('-').lower()[:180]


def run_pdftotext(pdf_path: Path, txt_path: Path) -> bool:
    try:
        subprocess.run(
            ['pdftotext', '-layout', str(pdf_path), str(txt_path)],
            check=True, capture_output=True, timeout=PDFTOTEXT_TIMEOUT,
        )
        return txt_path.exists() and txt_path.stat().st_size > 0
    except FileNotFoundError:
        print('[fatal] pdftotext not installed; apt-get install poppler-utils', file=sys.stderr)
        raise
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Chunking + embedding
# ---------------------------------------------------------------------------

def chunk_text(text: str) -> list[dict]:
    """Return [{'content': str, 'heading': str|None}]. Heading-aware best-effort."""
    # Normalize whitespace; collapse 3+ newlines to 2
    text = re.sub(r'\r', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    if not text:
        return []

    paras = [p.strip() for p in text.split('\n\n') if p.strip()]
    out: list[dict] = []
    buf = ''
    heading: str | None = None

    def flush():
        if buf.strip():
            out.append({'content': buf.strip(), 'heading': heading})

    for p in paras:
        first_line = p.split('\n', 1)[0].strip()
        # Heading heuristic: short line, Title-Case or ALL-CAPS, no period at end
        if (
            len(first_line) < 90
            and not first_line.endswith('.')
            and (first_line.isupper() or re.match(r'^[A-Z][A-Za-z0-9,\s\-:()]+$', first_line))
            and len(p) < 200
            and len(first_line.split()) >= 2
        ):
            heading = first_line[:200]

        if len(buf) + len(p) + 2 > CHUNK_MAX_CHARS:
            flush()
            carry = buf[-CHUNK_OVERLAP_CHARS:]
            buf = (carry + '\n\n' if carry else '') + p
        else:
            buf = f'{buf}\n\n{p}' if buf else p
    flush()
    return out


def embed_batch(vo: voyageai.Client, texts: list[str]) -> list[list[float]]:
    res = vo.embed(texts, model=EMBED_MODEL, input_type='document')
    return res.embeddings


# ---------------------------------------------------------------------------
# Supabase IO
# ---------------------------------------------------------------------------

def fetch_targets(sb: Client, limit: int | None) -> list[dict]:
    q = (sb.table('sources')
         .select('id, title, doi, drive_location, topic_category, rights_download, has_pdf')
         .in_('rights_download', list(OA_RIGHTS))
         .eq('has_pdf', False)
         .not_.is_('doi', 'null')
         .order('drive_location')
         .order('year_published', desc=True))
    if limit:
        q = q.limit(limit)
    return q.execute().data or []


def write_chunks(sb: Client, source_id: str, rows: list[dict]) -> None:
    # Clear old chunks for this source (re-ingest path)
    sb.table('chunks').delete().eq('source_id', source_id).execute()
    if not rows:
        return
    # Supabase batch insert caps — 500 rows is fine
    for i in range(0, len(rows), 200):
        sb.table('chunks').insert(rows[i:i + 200]).execute()


def mark_source_ingested(sb: Client, source_id: str, sha256: str, pdf_rel_path: str,
                         txt_bytes: int, pdf_bytes: int, resolver: str, chunks: int) -> None:
    sb.table('sources').update({
        'has_pdf': True,
        'sha256': sha256,
        'path': pdf_rel_path,
        'metadata': {
            'resolver': resolver,
            'pdf_bytes': pdf_bytes,
            'txt_bytes': txt_bytes,
            'chunks': chunks,
            'ingested_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        },
    }).eq('id', source_id).execute()


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

@dataclass
class RunStats:
    checked: int = 0
    resolved: int = 0
    downloaded: int = 0
    extracted: int = 0
    ingested: int = 0
    unresolved: int = 0
    errors: int = 0


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    ap.add_argument('--dry-run', action='store_true', help='Resolve only; no download')
    ap.add_argument('--only-resolve', action='store_true', help='Resolve URLs and write oa_manifest.jsonl')
    ap.add_argument('--pdf-root', default=os.environ.get('BIBLIOGRAPHY_PDF_ROOT') or str(DEFAULT_PDF_ROOT))
    ap.add_argument('--sleep-ncbi', type=float, default=0.34, help='seconds between NCBI calls (3/s)')
    ap.add_argument('--sleep-download', type=float, default=0.75)
    args = ap.parse_args()

    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    email = os.environ.get('UNPAYWALL_EMAIL')
    ncbi_key = os.environ.get('NCBI_API_KEY') or None
    if not url or not key:
        raise SystemExit('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required')
    if not email and not args.only_resolve and not args.dry_run:
        raise SystemExit('UNPAYWALL_EMAIL required (Unpaywall blocks anonymous)')

    sb = create_client(url, key)
    vo = voyageai.Client(api_key=os.environ['VOYAGE_API_KEY']) if not args.only_resolve else None

    session = requests.Session()
    session.headers.update({'User-Agent': USER_AGENT, 'Accept': 'application/json, application/pdf;q=0.9, */*;q=0.1'})

    pdf_root = Path(args.pdf_root)
    pdf_root.mkdir(parents=True, exist_ok=True)

    targets = fetch_targets(sb, args.limit)
    print(f'[fetch] {len(targets)} open-access sources without PDFs queued')

    stats = RunStats()
    unresolved_path = pdf_root.parent / 'unresolved.jsonl'
    manifest_path = pdf_root.parent / 'oa_manifest.jsonl'
    unresolved_f = open(unresolved_path, 'a', encoding='utf-8')
    manifest_f = open(manifest_path, 'a', encoding='utf-8')

    for row in tqdm(targets, desc='oa'):
        stats.checked += 1
        doi = row['doi']
        drive_loc = row.get('drive_location') or 'Uncategorized'
        slug = slugify_doi(doi)

        # --- 1. Resolve ---
        res = resolve_via_pmc(doi, session, ncbi_key)
        _sleep(args.sleep_ncbi)
        if not res.pdf_url:
            res = resolve_via_unpaywall(doi, session, email or 'research@example.org')
            _sleep(args.sleep_ncbi)

        if not res.pdf_url:
            stats.unresolved += 1
            unresolved_f.write(json.dumps({
                'id': row['id'], 'doi': doi, 'title': row['title'], 'notes': res.notes,
            }) + '\n')
            continue
        stats.resolved += 1

        manifest_f.write(json.dumps({
            'id': row['id'], 'doi': doi, 'resolver': res.resolver, 'pdf_url': res.pdf_url,
            'pmcid': res.pmcid, 'drive_location': drive_loc,
        }) + '\n')
        if args.only_resolve:
            continue

        if args.dry_run:
            continue

        # --- 2. Download ---
        topic_dir = pdf_root / re.sub(r'[^A-Za-z0-9_-]+', '_', drive_loc)
        topic_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = topic_dir / f'{slug}.pdf'
        txt_path = topic_dir / f'{slug}.txt'
        if pdf_path.exists() and pdf_path.stat().st_size > 1024:
            blob = pdf_path.read_bytes()
        else:
            blob = download_pdf(res.pdf_url, session)
            _sleep(args.sleep_download)
            if not blob:
                stats.errors += 1
                unresolved_f.write(json.dumps({
                    'id': row['id'], 'doi': doi, 'title': row['title'],
                    'notes': ['download failed', res.pdf_url],
                }) + '\n')
                continue
            pdf_path.write_bytes(blob)
        stats.downloaded += 1

        # --- 3. Extract text ---
        if not run_pdftotext(pdf_path, txt_path):
            stats.errors += 1
            unresolved_f.write(json.dumps({
                'id': row['id'], 'doi': doi, 'title': row['title'], 'notes': ['pdftotext failed'],
            }) + '\n')
            continue
        stats.extracted += 1

        text = txt_path.read_text(errors='ignore')
        chunks = chunk_text(text)
        if not chunks:
            stats.errors += 1
            continue

        # --- 4. Embed + insert ---
        chunk_rows = []
        for i in range(0, len(chunks), EMBED_BATCH):
            batch = chunks[i:i + EMBED_BATCH]
            vecs = embed_batch(vo, [c['content'] for c in batch])
            for j, c in enumerate(batch):
                chunk_rows.append({
                    'source_id': row['id'],
                    'chunk_index': i + j,
                    'heading': c['heading'],
                    'content': c['content'],
                    'token_count': int(len(c['content']) / 4),
                    'embedding': vecs[j],
                })

        try:
            write_chunks(sb, row['id'], chunk_rows)
            sha = hashlib.sha256(blob).hexdigest()
            rel = str(pdf_path.relative_to(pdf_root.parent.parent.parent))  # Purity-Lab-Data-root relative
            mark_source_ingested(
                sb, row['id'], sha, rel, txt_path.stat().st_size, len(blob), res.resolver or '?', len(chunk_rows),
            )
            stats.ingested += 1
        except Exception as e:
            stats.errors += 1
            unresolved_f.write(json.dumps({
                'id': row['id'], 'doi': doi, 'title': row['title'],
                'notes': [f'db write failed: {e}'],
            }) + '\n')
            continue

    unresolved_f.close()
    manifest_f.close()
    print()
    print(f'[done] checked={stats.checked} resolved={stats.resolved} downloaded={stats.downloaded} '
          f'extracted={stats.extracted} ingested={stats.ingested} unresolved={stats.unresolved} errors={stats.errors}')
    print(f'[logs] manifest  → {manifest_path}')
    print(f'[logs] unresolved → {unresolved_path}')


if __name__ == '__main__':
    main()
