'use client';

// Per-row citation helper. Click → dropdown with:
//   - BibTeX skeleton (DOI as key; reference managers fill in authors from DOI)
//   - Plain-text reference (Title. Year. DOI link.)
//   - Copy DOI only
// Author data isn't in our schema yet, so the BibTeX is intentionally minimal.

import { useState } from 'react';

type Row = {
  id: string;
  title: string;
  year_published: number | null;
  doi: string | null;
  drive_url: string | null;
  topic_category: string | null;
};

function bibtexKey(row: Row): string {
  // Prefer a DOI-derived key because it's stable and unique.
  if (row.doi) return row.doi.replace(/[^a-zA-Z0-9]/g, '_');
  return `source_${row.id.slice(0, 8)}`;
}

function bibtex(row: Row): string {
  const key = bibtexKey(row);
  const lines = [`@article{${key},`];
  lines.push(`  title  = {${row.title}}`);
  if (row.year_published) lines.push(`,\n  year   = {${row.year_published}}`);
  if (row.doi) lines.push(`,\n  doi    = {${row.doi}}`);
  const url = row.drive_url ?? (row.doi ? `https://doi.org/${row.doi}` : null);
  if (url) lines.push(`,\n  url    = {${url}}`);
  lines.push(`\n  note   = {Author list not yet in catalog — resolve via DOI}`);
  lines.push('\n}');
  return lines.join('');
}

function plainText(row: Row): string {
  const bits: string[] = [];
  if (row.year_published) bits.push(`(${row.year_published})`);
  bits.push(row.title.replace(/\.$/, '') + '.');
  if (row.doi) bits.push(`https://doi.org/${row.doi}`);
  return bits.join(' ');
}

async function copy(text: string, setCopied: (v: string | null) => void, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  } catch {
    setCopied('error');
    setTimeout(() => setCopied(null), 1800);
  }
}

export function CiteButton({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-purity-bean/20 px-2 py-0.5 text-xs text-purity-muted hover:border-purity-green hover:text-purity-green dark:border-purity-paper/20 dark:text-purity-mist dark:hover:border-purity-aqua dark:hover:text-purity-aqua"
      >
        cite
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-purity-bean/15 bg-white p-1 shadow-md dark:border-purity-paper/15 dark:bg-purity-shade dark:shadow-black/40">
          <button
            type="button"
            onClick={() => copy(bibtex(row), setCopied, 'bibtex')}
            className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-purity-cream dark:hover:bg-purity-ink"
          >
            copy BibTeX
          </button>
          <button
            type="button"
            onClick={() => copy(plainText(row), setCopied, 'plain')}
            className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-purity-cream dark:hover:bg-purity-ink"
          >
            copy plain-text reference
          </button>
          {row.doi && (
            <button
              type="button"
              onClick={() => copy(row.doi!, setCopied, 'doi')}
              className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-purity-cream dark:hover:bg-purity-ink"
            >
              copy DOI
            </button>
          )}
          {copied && (
            <div className="mt-1 border-t border-purity-bean/10 px-3 py-1 text-xs text-purity-green dark:border-purity-paper/10 dark:text-purity-aqua">
              {copied === 'error' ? 'copy failed' : `copied ${copied}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
