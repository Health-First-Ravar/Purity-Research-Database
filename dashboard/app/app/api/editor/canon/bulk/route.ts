// POST /api/editor/canon/bulk
//
// Bulk-import canon_qa rows from a pasted block of text. Editor only.
//
// Body: { text: string; status?: 'draft' | 'active'; tags?: string[] }
//   default status = 'draft' so new entries flow through review unless caller
//   explicitly says 'active'.
//
// Auto-detects three input formats:
//   1) JSON array — [{ "question": "...", "answer": "..." }, ...]
//   2) TSV / CSV — "question<tab|comma>answer" one per line
//   3) Q:/A:    — "Q: ... \n A: ..." pairs separated by blank lines
//
// For each parsed pair:
//   - embed the question via Voyage
//   - insert into canon_qa with the chosen status
// Returns: { inserted, skipped, errors }

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, supabaseAdmin } from '@/lib/supabase';
import { embed } from '@/lib/voyage';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

type Parsed = { question: string; answer: string };

function parseInput(raw: string): Parsed[] {
  const text = raw.trim();
  if (!text) return [];

  // 1) JSON array path
  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) {
        return arr
          .map((row: unknown) => {
            const r = row as Record<string, unknown>;
            const q = String(r.question ?? r.q ?? '').trim();
            const a = String(r.answer ?? r.a ?? '').trim();
            return { question: q, answer: a };
          })
          .filter((p) => p.question && p.answer);
      }
    } catch { /* fall through */ }
  }

  // 2) TSV / CSV — heuristic: tab-separated wins if any line has a tab,
  //    else fall back to comma-separated only if 80% of lines have exactly one comma
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const hasTab = lines.some((l) => l.includes('\t'));
  if (hasTab) {
    const out: Parsed[] = [];
    for (const line of lines) {
      const [q, ...rest] = line.split('\t');
      const a = rest.join('\t').trim();
      if (q?.trim() && a) out.push({ question: q.trim(), answer: a });
    }
    if (out.length) return out;
  }

  // 3) Q:/A: blocks separated by blank lines
  const blocks = text.split(/\n\s*\n+/);
  const out: Parsed[] = [];
  for (const block of blocks) {
    // Match "Q: ..." then "A: ..." (case-insensitive, multiline)
    const m = block.match(/^\s*Q\s*[:.\-]\s*([\s\S]*?)\n\s*A\s*[:.\-]\s*([\s\S]+?)\s*$/i);
    if (m) {
      const q = m[1].trim().replace(/\s+/g, ' ');
      const a = m[2].trim();
      if (q && a) out.push({ question: q, answer: a });
      continue;
    }
    // Fallback: two-line block where line 1 is the question, line 2+ is the answer
    const splitLines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (splitLines.length >= 2) {
      const q = splitLines[0].replace(/^Q\s*[:.\-]\s*/i, '').replace(/\?$/, '?');
      const a = splitLines.slice(1).join(' ').replace(/^A\s*[:.\-]\s*/i, '');
      if (q.length > 4 && a.length > 4 && /[?]/.test(q)) {
        out.push({ question: q, answer: a });
      }
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: profile } = await sb
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) {
    return NextResponse.json({ error: 'editor role required' }, { status: 403 });
  }

  let body: { text?: string; status?: string; tags?: string[]; preview?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const text = (body.text ?? '').trim();
  if (text.length < 10) {
    return NextResponse.json({ error: 'text_too_short', message: 'Need at least 10 characters.' }, { status: 400 });
  }
  if (text.length > 200_000) {
    return NextResponse.json({ error: 'text_too_long', message: 'Cap at 200k chars per bulk paste.' }, { status: 400 });
  }

  const status = body.status === 'active' ? 'active' : 'draft';
  const tags = Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean) : [];

  const pairs = parseInput(text);
  if (pairs.length === 0) {
    return NextResponse.json({
      error: 'no_pairs_parsed',
      message: 'Could not parse any question/answer pairs. Supported formats: JSON array, TSV (question<TAB>answer per line), or "Q: ... / A: ..." blocks separated by blank lines.',
    }, { status: 400 });
  }

  // Preview-only: don't write
  if (body.preview) {
    return NextResponse.json({ preview: true, count: pairs.length, pairs: pairs.slice(0, 50) });
  }

  // Embed all questions in batches of 32 (Voyage handles array input)
  const adb = supabaseAdmin();
  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < pairs.length; i += 32) {
    const batch = pairs.slice(i, i + 32);
    try {
      const vecs = await embed(batch.map((p) => p.question), 'document');
      const rows = batch.map((p, j) => ({
        question: p.question,
        answer:   p.answer,
        question_embed: vecs[j] as unknown as string,
        status,
        tags,
        created_by: auth.user!.id,
        last_reviewed_at: status === 'active' ? new Date().toISOString() : null,
        reviewed_by:      status === 'active' ? auth.user!.id          : null,
      }));
      const { error } = await adb.from('canon_qa').insert(rows);
      if (error) {
        errors.push(`batch ${i}: ${error.message}`);
      } else {
        inserted += rows.length;
      }
    } catch (e: unknown) {
      errors.push(`batch ${i}: ${String(e)}`);
    }
  }

  return NextResponse.json({
    inserted,
    parsed: pairs.length,
    skipped: pairs.length - inserted,
    status,
    errors,
  });
}
