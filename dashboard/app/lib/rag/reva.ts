// Ask Reva — operator-mode chat for editors (Jeremy / Ildi).
//
// Three modes (CREATE / ANALYZE / CHALLENGE) each get:
//   * a system prompt sliced from knowledge-base/reva/SKILL.md so the prompts
//     stay in sync with the canonical skill (read at request time on the
//     server; cached in-memory for the lifetime of the lambda)
//   * different retrieval weights between brand-voice (purity_brain + reva_skill),
//     evidence (research_paper + coffee_book) and lab data (coa)
//
// Unlike /api/chat, Reva is allowed to synthesize beyond the chunks. When she
// does, she sets flags.left_evidence = true. The UI surfaces this as a banner
// so the operator knows where to push back.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL_GENERATE } from '../anthropic';
import { embedOne } from '../voyage';
import { supabaseAdmin } from '../supabase';
import { ALL_COA_SCOPES } from '../coa-scope';

export type RevaMode = 'create' | 'analyze' | 'challenge';

export type RevaPriorTurn = { role: 'user' | 'assistant'; content: string };

export type RevaChunk = {
  id: string;
  source_id: string;
  heading: string | null;
  content: string;
  similarity: number;
  kind: string;
  title: string;
  chapter: string | null;
};

/**
 * Who this request may see COA data as.
 *
 * `allowedScopes: null` = unrestricted (admin/editor, the audit view).
 * `['purity']` = the customer-service allowlist. Resolve it with `getCoaViewer`
 * at the route so Reva and /api/chat derive visibility from one place.
 *
 * `client` should be the CALLER's Supabase client. Omitting it falls back to
 * the service-role client, which bypasses RLS — acceptable only for scripts and
 * ingestion, never for a user-facing request.
 */
export type CoaAccess = {
  client?: SupabaseClient;
  allowedScopes: string[] | null;
};

export type RevaFlags = {
  left_evidence: boolean;
  regulatory_risk: boolean;
  weakest_link: 'mechanism' | 'bioavailability' | 'evidence' | 'practical' | null;
};

export type RevaAnswer = {
  answer: string;
  mode: RevaMode;
  cited_chunk_ids: string[];
  retrieved_chunk_ids: string[];
  cited_chunks: RevaChunk[];
  flags: RevaFlags;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
};

// ---------------------------------------------------------------------------
// Mode prompt loader — slice SKILL.md by H3 section headings.
// ---------------------------------------------------------------------------
// SKILL.md lives at the REPO ROOT, but Next runs with process.cwd() set to
// dashboard/app, so a bare cwd join silently misses it. Resolve against every
// plausible anchor and take the first that exists, so this works from the app
// dir, the repo root, and a traced serverless bundle alike.
function skillPathCandidates(): string[] {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '..', '..', 'knowledge-base', 'reva', 'SKILL.md'), // cwd = dashboard/app
    path.join(cwd, 'knowledge-base', 'reva', 'SKILL.md'),             // cwd = repo root
  ];
  try {
    // Anchor on this module's own location — survives an unexpected cwd.
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.join(here, '..', '..', '..', '..', 'knowledge-base', 'reva', 'SKILL.md'));
  } catch {
    // import.meta.url unavailable under this bundler; cwd candidates stand.
  }
  return candidates;
}

export class RevaSkillUnavailableError extends Error {
  constructor(tried: string[]) {
    super(
      'Reva SKILL.md could not be loaded, so the mode prompts would be empty. ' +
        'Refusing to answer with an unconfigured persona. Tried:\n  ' +
        tried.join('\n  '),
    );
    this.name = 'RevaSkillUnavailableError';
  }
}

let modePromptsCache: Record<RevaMode, string> | null = null;

const RETRIEVAL_WEIGHTS: Record<RevaMode, { brand: number; evidence: number }> = {
  create:    { brand: 0.6, evidence: 0.4 },
  analyze:   { brand: 0.2, evidence: 0.8 },
  challenge: { brand: 0.1, evidence: 0.9 },
};

const TOTAL_CHUNKS = 12;

// --- COA (lab data) retrieval -----------------------------------------------
// Reva could not see a single Certificate of Analysis before this: the two RPCs
// below were pinned to brand + research kinds, so every COA question was
// answered "I don't have access to those documents" while 323 rows sat in the
// database. There was no persona rule and no allow-list entry causing it — the
// kind was simply never requested.
//
// The COA leg is ADDITIVE. Brand and evidence keep their exact former counts,
// so nothing about Reva's existing behaviour shifts; lab chunks arrive on top.
const COA_CHUNKS = 4;

// Same 0.30 floor as the other two legs. A stricter floor was tried first and
// was wrong in both directions: measured against this corpus, a genuine COA
// tops out at 0.420 for "what is the most recent COA" (so 0.45 returned
// nothing), while misclassified book-manuscript chunks reached 0.546 on a brand
// question. Similarity does not separate these; provenance does, and the scope
// join below handles it. With that join in place, brand / mechanism / challenge
// questions retrieve zero COA chunks even at a 0.0 floor, so the floor is not
// carrying the noise argument and does not need to be special.
const COA_MIN_SIMILARITY = 0.30;

const MODE_HEADINGS: Record<RevaMode, RegExp[]> = {
  create: [
    /## Content Production: Full Guidance \(MODE 1: CREATE\)/i,
    /### MODE 1: CREATE/i,
    /MODE 1: CREATE/i,
  ],
  analyze: [
    /## ANALYZE Mode: Reasoning Protocols/i,
    /### MODE 2: ANALYZE/i,
    /MODE 2: ANALYZE/i,
  ],
  challenge: [
    /## CHALLENGE Mode: Adversarial Reasoning/i,
    /### MODE 3: CHALLENGE/i,
    /MODE 3: CHALLENGE/i,
  ],
};

async function loadModePrompts(): Promise<Record<RevaMode, string>> {
  if (modePromptsCache) return modePromptsCache;

  const tried = skillPathCandidates();
  let skill = '';
  let loadedFrom: string | null = null;
  for (const p of tried) {
    try {
      skill = await fs.readFile(p, 'utf-8');
      loadedFrom = p;
      break;
    } catch {
      // try the next candidate
    }
  }

  // Previously this was `.catch(() => '')`, which produced empty prompts for
  // all three modes and served them as if configured — a silent 200 with an
  // unconfigured persona. Fail loudly instead.
  if (!loadedFrom || !skill.trim()) {
    console.error('[reva] FATAL: SKILL.md not found. Tried:', tried);
    throw new RevaSkillUnavailableError(tried);
  }

  const out: Record<RevaMode, string> = { create: '', analyze: '', challenge: '' };
  const empty: RevaMode[] = [];
  for (const mode of Object.keys(MODE_HEADINGS) as RevaMode[]) {
    out[mode] = sliceSection(skill, MODE_HEADINGS[mode]);
    if (!out[mode].trim()) empty.push(mode);
  }

  // The file loaded but a heading moved — also a silent-degradation path.
  if (empty.length) {
    console.error(
      `[reva] FATAL: loaded ${loadedFrom} but no section matched for mode(s): ${empty.join(', ')}. ` +
        'MODE_HEADINGS is out of sync with SKILL.md.',
    );
    throw new Error(
      `Reva SKILL.md loaded from ${loadedFrom} but no section matched for: ${empty.join(', ')}. ` +
        'The mode headings in lib/rag/reva.ts no longer match the document.',
    );
  }

  console.log(
    `[reva] loaded SKILL.md from ${loadedFrom} — ` +
      (Object.keys(out) as RevaMode[]).map((m) => `${m}:${out[m].length}b`).join(' '),
  );
  modePromptsCache = out;
  return out;
}

function sliceSection(doc: string, headings: RegExp[]): string {
  for (const re of headings) {
    const m = doc.match(re);
    if (!m) continue;
    const start = m.index ?? 0;
    // End at the next H2 of equal level; fall back to a 4 KB cap.
    const rest = doc.slice(start + m[0].length);
    const next = rest.search(/\n##\s/);
    return doc.slice(start, start + m[0].length + (next === -1 ? 4000 : next));
  }
  return '';
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------
function buildSystemPrompt(mode: RevaMode, sliced: string): string {
  const modeRules: Record<RevaMode, string> = {
    create: `You are in CREATE mode. Produce content in Jeremy Rävar's voice — direct,
peer-level, precise, warm. Health-claim language: "may support", "associated with",
"research suggests". Never "cures", "prevents", "treats". Lead with the idea.
One focused topic per response.`,
    analyze: `You are in ANALYZE mode. Reason through evidence using the Compound
Reasoning Stack (mechanism → bioavailability → evidence quality → practical
implication). Surface tensions, name effect sizes when you can, distinguish
hypothesis from claim.`,
    challenge: `You are in CHALLENGE mode. Take the strongest opposing position.
Identify where the evidence runs out or logic depends on an unargued premise.
End with the reconstructed claim — the version that holds. If the original
claim survives scrutiny, say so plainly and explain why.`,
  };

  return `You are Reva — peer-level intellectual partner to Jeremy Rävar and
Ildi Revi on Circular Health Coffee (CHC) and Purity Coffee.

${modeRules[mode]}

You may synthesize beyond the provided <evidence> chunks when the question
calls for it. When you do, set flags.left_evidence = true and say so plainly
in the answer. When you stay within the evidence, set it to false.

You DO have access to Purity's Certificate of Analysis (COA) lab data. It
arrives as evidence chunks with kind "coa" and holds real measured analyte
values for real lots. Use them when a question concerns lab results, and quote
the report number and date so the operator can trace the figure. If no coa
chunk was retrieved for a lab question, say the retrieval returned nothing for
that query — do not say you have no access to COA documents, because you do.

Two rules on lab data. A COA is COMPOSITION evidence, never EFFICACY evidence:
it shows what is in the coffee, never that the coffee does anything
physiological, so it can never carry a health claim on its own. And a result
reported below the limit of quantitation is a NON-DETECTION, not a measurement
at the threshold — report it as not detected, with the bound.

Set flags.regulatory_risk = true if your draft contains any disease/treat/cure/prevent
language or any unhedged health claim. Set flags.weakest_link to the layer of
the Compound Reasoning Stack the answer is most exposed on, or null.

Return ONLY valid JSON in this exact shape:
{
  "answer": "<markdown OK; 1-6 paragraphs>",
  "cited_chunk_ids": ["<uuid>", ...],
  "flags": {
    "left_evidence": <true|false>,
    "regulatory_risk": <true|false>,
    "weakest_link": "mechanism"|"bioavailability"|"evidence"|"practical"|null
  }
}

---
Reference (your own canonical skill, ${mode.toUpperCase()} section):

${sliced}`;
}

// ---------------------------------------------------------------------------
// Weighted retrieval: two RPCs, merged at the requested ratio.
// ---------------------------------------------------------------------------
async function retrieveWeighted(
  vec: number[],
  mode: RevaMode,
  coa: CoaAccess,
): Promise<RevaChunk[]> {
  const sb = supabaseAdmin();
  const w = RETRIEVAL_WEIGHTS[mode];
  const brandCount = Math.round(TOTAL_CHUNKS * w.brand);
  const evidenceCount = TOTAL_CHUNKS - brandCount;

  // The COA leg runs on the CALLER's client, not the admin one, so RLS on
  // sources/coas independently withholds rows this viewer may not see. The
  // explicit allowed_coa_scopes argument is the second control: match_chunks is
  // security-invoker and only honours the parameter when auth.uid() is null
  // (service_role), so a user-scoped call is floored by the database regardless
  // of what we pass. Two independent controls, same as /api/chat.
  const coaClient = coa.client ?? sb;

  // `null` means "unrestricted" everywhere else in this codebase, but handing
  // null to match_chunks would also switch OFF the provenance join and let the
  // unclassified `kind='coa'` sources (book manuscripts, orphans) into Reva's
  // evidence. Elevated viewers therefore get the explicit full scope list,
  // which admits every genuine certificate and nothing else. See ALL_COA_SCOPES.
  const coaScopes: string[] = coa.allowedScopes ?? [...ALL_COA_SCOPES];

  const [brandRes, evidenceRes, coaRes] = await Promise.all([
    brandCount > 0
      ? sb.rpc('match_chunks', {
          query_embedding: vec as unknown as string,
          match_count: brandCount,
          source_kinds: ['purity_brain', 'reva_skill'],
          min_similarity: 0.30,
        })
      : Promise.resolve({ data: [] as RevaChunk[] }),
    evidenceCount > 0
      ? sb.rpc('match_chunks', {
          query_embedding: vec as unknown as string,
          match_count: evidenceCount,
          source_kinds: ['research_paper', 'coffee_book'],
          min_similarity: 0.30,
        })
      : Promise.resolve({ data: [] as RevaChunk[] }),
    coaClient.rpc('match_chunks', {
      query_embedding: vec as unknown as string,
      match_count: COA_CHUNKS,
      source_kinds: ['coa'],
      min_similarity: COA_MIN_SIMILARITY,
      allowed_coa_scopes: coaScopes,
    }),
  ]);

  // A failed COA leg must not look like "no lab data exists" — that is the exact
  // silent degradation that made Reva deny having COA access in the first place.
  if (coaRes.error) {
    console.error('[reva] COA retrieval failed:', coaRes.error);
  }

  const merged = [
    ...((brandRes.data ?? []) as RevaChunk[]),
    ...((evidenceRes.data ?? []) as RevaChunk[]),
    ...((coaRes.data ?? []) as RevaChunk[]),
  ];
  // Dedupe + sort by similarity desc
  const seen = new Set<string>();
  return merged
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .sort((a, b) => b.similarity - a.similarity);
}

// ---------------------------------------------------------------------------
// askReva — main entry point
// ---------------------------------------------------------------------------
export async function askReva(args: {
  question: string;
  mode: RevaMode;
  prior: RevaPriorTurn[];      // last 4-6 turns of session context
  coa: CoaAccess;
}): Promise<RevaAnswer> {
  const { question, mode, prior, coa } = args;
  const t0 = Date.now();

  const [vec, modePrompts] = await Promise.all([
    embedOne(question, 'query'),
    loadModePrompts(),
  ]);
  const chunks = await retrieveWeighted(vec, mode, coa);

  const evidenceBlock = chunks.length
    ? chunks
        .map(
          (c, i) =>
            `--- chunk ${i + 1} (id=${c.id}, ${c.kind}:${c.title}${
              c.chapter ? `, ch ${c.chapter}` : ''
            }, sim=${c.similarity.toFixed(3)}) ---\n${
              c.heading ? `# ${c.heading}\n` : ''
            }${c.content}`,
        )
        .join('\n\n')
    : '(no retrieved evidence)';

  const priorBlock = prior.length
    ? prior.slice(-6).map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n')
    : '(no prior turns)';

  const userContent = `<mode>${mode}</mode>
<prior_turns>
${priorBlock}
</prior_turns>
<evidence>
${evidenceBlock}
</evidence>
<question>${question}</question>`;

  const system = buildSystemPrompt(mode, modePrompts[mode]);

  const res = await anthropic.messages.create({
    model: MODEL_GENERATE,
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = res.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');

  const parsed = parseRevaJson(text);
  const tokens_in = res.usage?.input_tokens ?? 0;
  const tokens_out = res.usage?.output_tokens ?? 0;
  const cost_usd = (tokens_in * 3 + tokens_out * 15) / 1_000_000;

  return {
    answer: parsed.answer,
    mode,
    cited_chunk_ids: parsed.cited_chunk_ids,
    retrieved_chunk_ids: chunks.map((c) => c.id),
    cited_chunks: chunks.filter((c) => parsed.cited_chunk_ids.includes(c.id)),
    flags: parsed.flags,
    tokens_in,
    tokens_out,
    cost_usd,
    latency_ms: Date.now() - t0,
  };
}

type ParsedReva = {
  answer: string;
  cited_chunk_ids: string[];
  flags: RevaFlags;
};

function parseRevaJson(raw: string): ParsedReva {
  const fallback: ParsedReva = {
    answer: raw.trim(),
    cited_chunk_ids: [],
    flags: { left_evidence: true, regulatory_risk: false, weakest_link: null },
  };
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    const j = JSON.parse(m[0]);
    const flags = (j.flags ?? {}) as Partial<RevaFlags>;
    return {
      answer: String(j.answer ?? '').trim(),
      cited_chunk_ids: Array.isArray(j.cited_chunk_ids) ? j.cited_chunk_ids.map(String) : [],
      flags: {
        left_evidence: Boolean(flags.left_evidence ?? false),
        regulatory_risk: Boolean(flags.regulatory_risk ?? false),
        weakest_link: ['mechanism', 'bioavailability', 'evidence', 'practical'].includes(
          flags.weakest_link as string,
        )
          ? (flags.weakest_link as RevaFlags['weakest_link'])
          : null,
      },
    };
  } catch {
    return fallback;
  }
}

// Used by `/verify-reva-modes` script.
export const __testing = { loadModePrompts, retrieveWeighted, RETRIEVAL_WEIGHTS };
