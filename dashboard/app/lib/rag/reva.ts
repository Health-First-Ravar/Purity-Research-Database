// Ask Reva — operator-mode chat for editors (Jeremy / Ildi).
//
// Three modes (CREATE / ANALYZE / CHALLENGE) each get:
//   * a system prompt sliced from knowledge-base/reva/SKILL.md so the prompts
//     stay in sync with the canonical skill (read at request time on the
//     server; cached in-memory for the lifetime of the lambda)
//   * different retrieval weights between brand-voice (purity_brain + reva_skill)
//     and evidence (research_paper + coffee_book)
//
// Unlike /api/chat, Reva is allowed to synthesize beyond the chunks. When she
// does, she sets flags.left_evidence = true. The UI surfaces this as a banner
// so the operator knows where to push back.

import path from 'node:path';
import fs from 'node:fs/promises';
import { anthropic, MODEL_GENERATE } from '../anthropic';
import { embedOne } from '../voyage';
import { supabaseAdmin } from '../supabase';

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
const SKILL_PATH = path.join(process.cwd(), 'knowledge-base', 'reva', 'SKILL.md');

let modePromptsCache: Record<RevaMode, string> | null = null;

const RETRIEVAL_WEIGHTS: Record<RevaMode, { brand: number; evidence: number }> = {
  create:    { brand: 0.6, evidence: 0.4 },
  analyze:   { brand: 0.2, evidence: 0.8 },
  challenge: { brand: 0.1, evidence: 0.9 },
};

const TOTAL_CHUNKS = 12;

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
  const skill = await fs.readFile(SKILL_PATH, 'utf-8').catch(() => '');
  const out: Record<RevaMode, string> = {
    create: '',
    analyze: '',
    challenge: '',
  };
  for (const mode of Object.keys(MODE_HEADINGS) as RevaMode[]) {
    out[mode] = sliceSection(skill, MODE_HEADINGS[mode]);
  }
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
): Promise<RevaChunk[]> {
  const sb = supabaseAdmin();
  const w = RETRIEVAL_WEIGHTS[mode];
  const brandCount = Math.round(TOTAL_CHUNKS * w.brand);
  const evidenceCount = TOTAL_CHUNKS - brandCount;

  const [brandRes, evidenceRes] = await Promise.all([
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
  ]);

  const merged = [
    ...((brandRes.data ?? []) as RevaChunk[]),
    ...((evidenceRes.data ?? []) as RevaChunk[]),
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
}): Promise<RevaAnswer> {
  const { question, mode, prior } = args;
  const t0 = Date.now();

  const [vec, modePrompts] = await Promise.all([
    embedOne(question, 'query'),
    loadModePrompts(),
  ]);
  const chunks = await retrieveWeighted(vec, mode);

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
