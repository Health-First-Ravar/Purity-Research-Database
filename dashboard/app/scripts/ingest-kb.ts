// Ingest /knowledge-base into Supabase: one row per source, chunks embedded
// with Voyage voyage-3-large, upserted into chunks.
//
// Usage:
//   tsx scripts/ingest-kb.ts [--kb /absolute/path/to/knowledge-base] [--dry]
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { embed } from '../lib/voyage';

const KB_ARG = process.argv.indexOf('--kb');
const DEFAULT_KB = '/Users/jeremybehne/Library/CloudStorage/GoogleDrive-jravar@puritycoffee.com/My Drive/Purity-Lab-Data/knowledge-base';
const KB_ROOT = KB_ARG >= 0 ? process.argv[KB_ARG + 1] : DEFAULT_KB;
const DRY = process.argv.includes('--dry');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('Supabase URL/service-role key required');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// Targets: text/markdown files. PDFs are skipped — use the paired .txt.
const TEXT_EXT = /\.(md|txt)$/i;
const MAX_TOKENS = 1000;     // rough char/token budget; pre-tokenize pass not needed at MVP
const OVERLAP  = 150;

type SourceKind =
  | 'research_paper' | 'coffee_book' | 'purity_brain' | 'reva_skill'
  | 'coa' | 'product_pdf' | 'faq' | 'web' | 'review' | 'canon';

function detectKind(relPath: string): SourceKind {
  if (relPath.startsWith('reva/'))         return 'reva_skill';
  if (relPath.startsWith('purity-brain/')) return 'purity_brain';
  if (relPath.startsWith('coffee-book/'))  return 'coffee_book';
  if (relPath.startsWith('research/'))     return 'research_paper';
  return 'web';
}

function detectChapter(relPath: string): string | null {
  const m = relPath.match(/by-chapter\/([0-9.]+)\//);
  return m ? m[1] : null;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (TEXT_EXT.test(name)) acc.push(p);
  }
  return acc;
}

// Chunk by double-newline blocks, greedy pack up to MAX_TOKENS (chars/4 approx),
// carry last OVERLAP chars into the next chunk so retrieval doesn't lose context.
function chunkText(text: string): { content: string; heading: string | null }[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: { content: string; heading: string | null }[] = [];
  let buf = '';
  let currentHeading: string | null = null;

  const flush = () => {
    if (buf.trim().length) chunks.push({ content: buf.trim(), heading: currentHeading });
    buf = '';
  };

  for (const p of paras) {
    const headingMatch = p.match(/^#{1,6}\s+(.+)$/m);
    if (headingMatch) currentHeading = headingMatch[1].trim();

    if (buf.length + p.length + 2 > MAX_TOKENS * 4) {
      flush();
      // carry overlap
      const carry = buf.slice(-OVERLAP * 4);
      buf = carry + (carry ? '\n\n' : '') + p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  flush();
  return chunks;
}

async function upsertSource(args: {
  kind: SourceKind; title: string; relPath: string; sha256: string; chapter: string | null;
}) {
  const { data: existing } = await sb
    .from('sources')
    .select('id, sha256')
    .eq('path', args.relPath)
    .is('valid_until', null)
    .maybeSingle();

  if (existing && existing.sha256 === args.sha256) {
    return { id: existing.id as string, unchanged: true };
  }
  if (existing) {
    // Retire old version
    await sb.from('sources').update({ valid_until: new Date().toISOString() }).eq('id', existing.id);
  }
  const { data, error } = await sb
    .from('sources')
    .insert({
      kind: args.kind,
      title: args.title,
      path: args.relPath,
      sha256: args.sha256,
      chapter: args.chapter,
      freshness_tier: args.kind === 'coa' ? 'weekly' : 'stable',
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string, unchanged: false };
}

async function main() {
  const files = walk(KB_ROOT);
  console.log(`[ingest] scanning ${files.length} text files under ${KB_ROOT}`);
  let srcCount = 0, chunkCount = 0, unchanged = 0;

  for (const abs of files) {
    const rel = relative(KB_ROOT, abs);
    const raw = readFileSync(abs, 'utf8');
    const sha = createHash('sha256').update(raw).digest('hex');
    const kind = detectKind(rel);
    const chapter = detectChapter(rel);
    const title = deriveTitle(raw, basename(rel));

    if (DRY) {
      console.log(`[dry] ${rel} kind=${kind} ch=${chapter ?? '-'} sha=${sha.slice(0, 8)}`);
      continue;
    }

    const { id: source_id, unchanged: same } = await upsertSource({
      kind, title, relPath: rel, sha256: sha, chapter,
    });
    if (same) { unchanged++; continue; }
    srcCount++;

    // Clear old chunks for this source (new version)
    await sb.from('chunks').delete().eq('source_id', source_id);

    const chunks = chunkText(raw);
    if (!chunks.length) continue;

    // Embed in batches of 32
    for (let i = 0; i < chunks.length; i += 32) {
      const batch = chunks.slice(i, i + 32);
      const vecs = await embed(batch.map((c) => c.content), 'document');
      const rows = batch.map((c, j) => ({
        source_id,
        chunk_index: i + j,
        heading: c.heading,
        content: c.content,
        token_count: Math.round(c.content.length / 4),
        embedding: vecs[j] as unknown as string,
      }));
      const { error } = await sb.from('chunks').insert(rows);
      if (error) throw error;
      chunkCount += rows.length;
    }
    console.log(`[ingest] ${rel} → ${chunks.length} chunks`);
  }

  console.log(`\n[ingest] done. sources=${srcCount} unchanged=${unchanged} chunks=${chunkCount}`);
}

function deriveTitle(raw: string, fallback: string): string {
  const first = raw.split('\n').find((l) => /^#\s+/.test(l));
  if (first) return first.replace(/^#\s+/, '').trim().slice(0, 200);
  const line = raw.split('\n').find((l) => l.trim().length > 20);
  return (line ?? fallback).trim().slice(0, 200);
}

main().catch((e) => { console.error(e); process.exit(1); });
