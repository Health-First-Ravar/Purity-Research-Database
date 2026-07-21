// Structured COA lookup — the date/lot-aware complement to semantic retrieval.
//
// `match_chunks` orders purely by embedding distance (`c.embedding <=> query`),
// so it has no notion of recency and cannot reliably surface one lot by its
// report number: a report id is a low-signal token inside a 1024-dim embedding
// of a mostly-"not tested" analyte table. Measured against this corpus, asking
// "what is the most recent COA" returns certificates from 2021-2023, and naming
// report 5427133-0 ranks its own chunk 86th of 317 — far below the top 4 a
// caller ever sees.
//
// The fix is not a better embedding or a prompt tweak: recency is an ORDER, not
// a similarity, and `coas.report_date` is a real date column. So for date- and
// lookup-oriented questions we query `coas` directly (ordered / filtered in
// SQL), then hand back the certificates' ALREADY-EMBEDDED chunk text so Reva's
// evidence format is byte-identical to a semantic hit. No second renderer, and
// real chunk ids mean the caller's dedupe and citation paths keep working.
//
// Scope is enforced the same way the rest of the COA path enforces it: the
// query runs on the CALLER's client (so `coas_read` RLS withholds rows the
// viewer may not see) AND an explicit `product_scope` allowlist floors it for
// the service-role / ingestion case where RLS is bypassed. Competitors are
// excluded to match `embed-coas`, which never embeds them — so this leg can
// only surface certificates the semantic leg could also have surfaced.

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** A structured hit, shaped like a retrieved chunk plus its provenance. */
export type CoaLookupChunk = {
  id: string;
  source_id: string;
  heading: string | null;
  content: string;
  similarity: number; // sentinel — selection was structural, see `via`
  kind: string; // always 'coa'
  title: string;
  chapter: string | null;
  via: 'report_date' | 'report_number';
};

export type CoaLookupSignals = {
  recency: boolean;
  reportTokens: string[];
};

// A recency/superlative word...
const RECENCY =
  /\b(most[-\s]?recent|recent(?:ly)?|latest|newest|new(?:est)?|current(?:ly)?|up[-\s]?to[-\s]?date|last)\b/i;
// ...paired with a lab/COA context word, so "the latest research" or "our
// newest blend" does NOT drag lab records in, but "most recent COA" and "latest
// test results" do.
const COA_CTX =
  /\b(coas?|certificates?\s+of\s+analysis|certificate|analysis|lab(?:oratory)?|report|test(?:ed|ing|s|\s+results?)?|lot|batch|sample|assay|analyte|panel|ota|ochratoxin|aflatoxin|acrylamide|mycotoxins?|heavy[-\s]?metals?|pesticides?|chlorogenic|melanoidins?|trigonelline|caffeine|moisture)\b/i;

// Candidate report-number tokens: an alphanumeric run with an internal hyphen
// (BRN-49871855-0, S04082026-49608, 995712-01-DR), or a bare digit run of 5+
// (5427133). Deliberately loose: every candidate is verified against the DB
// before it selects anything, so a false candidate simply matches no row.
const REPORT_TOKEN = /\b(?:[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|\d{5,})\b/g;

// Words that look like report tokens under REPORT_TOKEN but never are — keep
// obvious noise out of the DB probe.
const TOKEN_STOPWORDS = new Set(['covid-19', 'omega-3', 'omega-6', 'co2', 'b12']);

export function detectCoaLookup(question: string): CoaLookupSignals {
  const recency = RECENCY.test(question) && COA_CTX.test(question);
  const reportTokens = Array.from(
    new Set((question.match(REPORT_TOKEN) ?? []).map((t) => t.trim())),
  )
    // strip anything a PostgREST `or()` filter treats as structure; report ids
    // are only [A-Za-z0-9-] so this cannot corrupt a real token.
    .map((t) => t.replace(/[^A-Za-z0-9-]/g, ''))
    .filter((t) => t.length >= 5 && !TOKEN_STOPWORDS.has(t.toLowerCase()))
    .slice(0, 5);
  return { recency, reportTokens };
}

type CoaIdRow = { id: string; report_number: string | null; report_date: string | null };

/**
 * Fetch structured COA evidence for a date/lookup question.
 *
 * @param client        the CALLER's Supabase client (RLS applies).
 * @param signals       output of `detectCoaLookup`.
 * @param allowedScopes product_scope allowlist. For an elevated viewer this is
 *                      `ALL_COA_SCOPES`; for CS it is `['purity']`. Competitors
 *                      are dropped regardless, to match `embed-coas`.
 * @param recencyLimit  how many most-recent certificates to pull (default 4).
 *
 * Returns [] on any error — a failed structured leg must degrade to plain
 * semantic retrieval, never break the request.
 */
export async function fetchCoaLookupChunks(
  client: SupabaseClient,
  signals: CoaLookupSignals,
  allowedScopes: string[],
  recencyLimit = 4,
): Promise<CoaLookupChunk[]> {
  try {
    // Map coa id -> how it was selected, preserving order (report hits first,
    // then most-recent). A coa matched by both keeps 'report_number'.
    const picked: { id: string; via: CoaLookupChunk['via'] }[] = [];
    const seenIds = new Set<string>();

    const base = () =>
      client
        .from('coas')
        .select('id, report_number, report_date')
        .is('retired_at', null)
        .neq('product_scope', 'competitor')
        .in('product_scope', allowedScopes);

    if (signals.reportTokens.length) {
      const orClause = signals.reportTokens
        .map((t) => `report_number.ilike.%${t}%`)
        .join(',');
      const { data, error } = await base()
        .or(orClause)
        .order('report_date', { ascending: false, nullsFirst: false })
        .limit(6);
      if (error) throw error;
      for (const r of (data ?? []) as CoaIdRow[]) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
        picked.push({ id: r.id, via: 'report_number' });
      }
    }

    if (signals.recency) {
      const { data, error } = await base()
        .not('report_date', 'is', null)
        .order('report_date', { ascending: false, nullsFirst: false })
        .limit(recencyLimit);
      if (error) throw error;
      for (const r of (data ?? []) as CoaIdRow[]) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
        picked.push({ id: r.id, via: 'report_date' });
      }
    }

    if (!picked.length) return [];

    // Pull the certificates' current (non-retired) source + its embedded chunk
    // in one round-trip. The chunk text is exactly what the vector store holds,
    // so nothing about how Reva reads a COA changes — only which ones arrive.
    const paths = picked.map((p) => `coa:${p.id}`);
    const { data: srcRows, error: srcErr } = await client
      .from('sources')
      .select('id, path, title, chunks(id, heading, content)')
      .in('path', paths)
      .is('valid_until', null);
    if (srcErr) throw srcErr;

    type SrcRow = {
      id: string;
      path: string;
      title: string;
      chunks: { id: string; heading: string | null; content: string }[] | null;
    };
    const byPath = new Map<string, SrcRow>();
    for (const s of (srcRows ?? []) as SrcRow[]) byPath.set(s.path, s);

    const out: CoaLookupChunk[] = [];
    for (const p of picked) {
      const s = byPath.get(`coa:${p.id}`);
      const chunk = s?.chunks?.[0];
      if (!s || !chunk) continue; // no current chunk (e.g. not yet embedded) — skip
      out.push({
        id: chunk.id,
        source_id: s.id,
        heading: chunk.heading,
        content: chunk.content,
        similarity: 1,
        kind: 'coa',
        title: s.title,
        chapter: null,
        via: p.via,
      });
    }
    return out;
  } catch (e) {
    console.error('[coa-lookup] structured leg failed, falling back to semantic only:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Threshold / aggregate lookup — "which lots exceed X", "how many are over the
// limit". Semantic search cannot answer these: it returns the top-k nearest
// chunks, so if those happen to be clean lots the model concludes "none exceed"
// even when over-limit lots exist. A "which rows satisfy a numeric predicate"
// question is a WHERE clause, not a similarity, so we run it against `coas`
// directly and hand back one authoritative, complete result block. Scope is
// enforced exactly like the date/lookup leg above.
// ---------------------------------------------------------------------------

export type CoaThresholdSpec = {
  column: string;
  label: string;
  unit: string;
  op: 'gt' | 'lt';
  threshold: number;
};

// Analytes we can evaluate against a numeric ceiling (contaminants) or floor
// (beneficial compounds). Ceilings/floors mirror Purity's coa_limits and the
// figures rendered on the reports pages.
const THRESHOLD_ANALYTES: {
  keys: RegExp;
  column: string;
  label: string;
  unit: string;
  ceiling?: number;
  floor?: number;
}[] = [
  { keys: /\b(ochratoxin|ota)\b/i, column: 'ota_ppb', label: 'ochratoxin A', unit: 'ppb', ceiling: 2 },
  { keys: /\baflatoxins?\b/i, column: 'aflatoxin_ppb', label: 'total aflatoxin', unit: 'ppb', ceiling: 4 },
  { keys: /\bacrylamide\b/i, column: 'acrylamide_ppb', label: 'acrylamide', unit: 'ppb', ceiling: 400 },
  { keys: /\b(chlorogenic|cgas?)\b/i, column: 'cga_mg_g', label: 'chlorogenic acids', unit: 'mg/g', floor: 40 },
];

// Aggregate framing: a set-selecting verb/quantifier plus a lot/report noun, or
// a bare superlative. "what is the OTA of PROTECT" must NOT trigger; "which lots
// exceed the OTA limit" and "how many reports are over 2 ppb" must.
const AGG_INTENT = /\b(which|what|any|list|how\s+many|are\s+there|show|find|are\s+any)\b/i;
const LOT_NOUN = /\b(lots?|coas?|reports?|samples?|certificates?|batches?|coffees?)\b/i;
const SUPERLATIVE = /\b(highest|lowest|max(?:imum)?|min(?:imum)?|worst|most)\b/i;
const OVER = /\b(exceed(?:s|ed|ing)?|over|above|higher|greater|more\s+than|breach(?:es|ed|ing)?|surpass(?:es|ed|ing)?|outside|fail(?:s|ed|ing)?)\b/i;
const UNDER = /\b(below|under|less\s+than|lower|beneath|short\s+of)\b/i;
const LIMIT_WORD = /\b(limit|ceiling|threshold|maximum|standard|spec|floor|minimum)\b/i;

/**
 * Detect a threshold/aggregate COA question and resolve it to a numeric
 * predicate. Returns null when the question is not of this shape, so the caller
 * simply falls through to normal retrieval.
 */
export function detectCoaThreshold(question: string): CoaThresholdSpec | null {
  const hasAggregate = AGG_INTENT.test(question) || SUPERLATIVE.test(question);
  if (!hasAggregate) return null;

  const analyte = THRESHOLD_ANALYTES.find((a) => a.keys.test(question));
  if (!analyte) return null;

  // Require a lot/report noun or an explicit limit word so a vague mention does
  // not trigger a full-table scan.
  if (!LOT_NOUN.test(question) && !LIMIT_WORD.test(question)) return null;

  // An explicit number is only trusted when it carries a unit ("2 ppb"), so
  // "top 5 lots" does not become a threshold of 5.
  const numMatch = question.match(/(\d+(?:\.\d+)?)\s*(ppb|mg\/g|%|ppm)\b/i);
  const explicit = numMatch ? parseFloat(numMatch[1]) : null;
  const over = OVER.test(question);
  const under = UNDER.test(question);

  if (analyte.ceiling != null) {
    // Contaminant: default to exceedance unless the question clearly asks "below".
    const op: 'gt' | 'lt' = under && !over ? 'lt' : 'gt';
    return {
      column: analyte.column,
      label: analyte.label,
      unit: analyte.unit,
      op,
      threshold: explicit ?? analyte.ceiling,
    };
  }
  if (analyte.floor != null) {
    // Beneficial compound: default to below-floor unless the question asks "over".
    const op: 'gt' | 'lt' = over && !under ? 'gt' : 'lt';
    return {
      column: analyte.column,
      label: analyte.label,
      unit: analyte.unit,
      op,
      threshold: explicit ?? analyte.floor,
    };
  }
  return null;
}

/**
 * Run the threshold predicate against `coas` and return a single authoritative
 * evidence chunk listing every matching lot (capped at 50). Same scope
 * enforcement as `fetchCoaLookupChunks`. Returns [] on error so the request
 * degrades to plain retrieval rather than failing.
 */
export async function fetchCoaThresholdChunk(
  client: SupabaseClient,
  spec: CoaThresholdSpec,
  allowedScopes: string[],
): Promise<CoaLookupChunk[]> {
  try {
    let q = client
      .from('coas')
      .select(`report_number, coffee_name, blend, report_date, ${spec.column}`)
      .is('retired_at', null)
      .neq('product_scope', 'competitor')
      .in('product_scope', allowedScopes)
      .not(spec.column, 'is', null);
    q = spec.op === 'gt' ? q.gt(spec.column, spec.threshold) : q.lt(spec.column, spec.threshold);
    const { data, error } = await q
      .order(spec.column, { ascending: spec.op === 'lt' })
      .limit(50);
    if (error) throw error;

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const cmp = spec.op === 'gt' ? 'above' : 'below';
    const otherSide = spec.op === 'gt' ? 'at or below' : 'at or above';

    const header =
      `STRUCTURED COA DATABASE QUERY (authoritative and complete, not semantic search).\n` +
      `Query: Purity lots with a measured ${spec.label} value ${cmp} ${spec.threshold} ${spec.unit}.\n` +
      `Result: ${rows.length} matching lot(s). This is the COMPLETE list for the records you can see. ` +
      `Any lot not listed is ${otherSide} ${spec.threshold} ${spec.unit}, or was not tested for ${spec.label} ` +
      `(a non-detection below the reporting limit is not "${cmp} the limit").`;

    const body = rows.length
      ? rows
          .map((r) => {
            const name = (r.coffee_name as string) || (r.blend as string) || '(unnamed)';
            const rn = (r.report_number as string) || '(no report number)';
            const val = r[spec.column];
            const date = r.report_date ? ` (${r.report_date as string})` : '';
            return `- ${rn} · ${name} · ${spec.label} ${val} ${spec.unit}${date}`;
          })
          .join('\n')
      : '(no lots match this predicate)';

    return [
      {
        id: randomUUID(),
        source_id: 'coa-threshold-query',
        heading: null,
        content: `${header}\n${body}`,
        similarity: 1,
        kind: 'coa',
        title: `Purity COA database: ${spec.label} ${cmp} ${spec.threshold} ${spec.unit}`,
        chapter: null,
        via: 'report_number',
      },
    ];
  } catch (e) {
    console.error('[coa-threshold] structured leg failed, falling back to semantic only:', e);
    return [];
  }
}
