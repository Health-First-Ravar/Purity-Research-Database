// Bioavailability Gap Detector — Reva CHALLENGE-mode audit of a draft.
//
// Pipeline:
//   1) embed the draft, retrieve top 8 evidence chunks (research + book only)
//   2) ask Sonnet to return a structured JSON audit covering the four
//      Compound Reasoning Stack layers (mechanism / bioavailability / evidence
//      / practical), regulatory flags, evidence tier, and a reconstructed claim
//   3) caller persists to public.claim_audits

import { anthropic, MODEL_GENERATE } from '../anthropic';
import { embedOne } from '../voyage';
import { supabaseAdmin } from '../supabase';

export type AuditContext = 'newsletter' | 'module' | 'chat_answer' | 'product_page' | 'other';

export type AuditFlag =
  | 'cure_word'
  | 'prevent_word'
  | 'treat_word'
  | 'cures_disease'
  | 'overstated_effect'
  | 'single_roast_overclaim'
  | 'in_vitro_to_human_jump'
  | 'observational_as_causal'
  | 'unfalsifiable_clean_claim'
  | 'organic_equals_healthier'
  | 'bioavailability_assumed'
  | 'unspecified_compound'
  | 'unspecified_dose';

export type AuditChunk = {
  id: string;
  source_id: string;
  heading: string | null;
  content: string;
  similarity: number;
  kind: string;
  title: string;
  chapter: string | null;
};

export type ClaimAudit = {
  draft_text: string;
  context: AuditContext;
  compounds_detected: string[];
  mechanism_engaged: boolean;
  bioavailability_engaged: boolean;
  evidence_engaged: boolean;
  practical_engaged: boolean;
  weakest_link: 'mechanism' | 'bioavailability' | 'evidence' | 'practical' | null;
  regulatory_flags: AuditFlag[];
  evidence_tier: number | null;          // 1..7 from Reva's Evidence Hierarchy
  suggested_rewrite: string;
  reasoning: string;                     // editor-only; not shown to user-facing UI by default
  cited_chunk_ids: string[];
  cited_chunks: AuditChunk[];
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
};

const SYSTEM = `You are Reva in CHALLENGE mode, auditing a draft sentence or paragraph
about coffee and health. Your job is to find where the claim runs ahead of its
evidence and offer the version that survives scrutiny.

Audit the draft against the Compound Reasoning Stack:
  1. mechanism      — biological pathway, receptor, enzyme
  2. bioavailability — does the compound survive digestion / absorption / first-pass?
  3. evidence_quality — RCT > meta-analysis > prospective cohort > cross-sectional > mechanistic > animal > in vitro
  4. practical      — what can legitimately be claimed / decided?

Detect compounds the draft names. Use canonical names:
  CGA, CGA-lactones, melanoidins, trigonelline, NMP, caffeine, cafestol, kahweol,
  OTA, aflatoxin, acrylamide, pesticides, heavy_metals, PFAS, mold

Regulatory flags to consider:
  cure_word, prevent_word, treat_word, cures_disease, overstated_effect,
  single_roast_overclaim, in_vitro_to_human_jump, observational_as_causal,
  unfalsifiable_clean_claim, organic_equals_healthier, bioavailability_assumed,
  unspecified_compound, unspecified_dose

Evidence tier (1..7) is the highest tier of evidence the draft actually relies
on, where 1 = pre-registered RCT and 7 = in vitro.

Return ONLY valid JSON in this exact shape — no prose:
{
  "compounds_detected": ["CGA", ...],
  "mechanism_engaged": true|false,
  "bioavailability_engaged": true|false,
  "evidence_engaged": true|false,
  "practical_engaged": true|false,
  "weakest_link": "mechanism"|"bioavailability"|"evidence"|"practical"|null,
  "regulatory_flags": ["cure_word", ...],
  "evidence_tier": 1..7|null,
  "suggested_rewrite": "<the version that holds up — use 'may support', 'associated with', 'research suggests'; never 'cures', 'prevents', 'treats'>",
  "reasoning": "<one or two sentences explaining the audit; editor log>",
  "cited_chunk_ids": ["<uuid>", ...]
}`;

export async function auditClaim(args: {
  draft: string;
  context: AuditContext;
}): Promise<ClaimAudit> {
  const { draft, context } = args;
  const t0 = Date.now();

  // 1) retrieve evidence — research_paper + coffee_book only.
  const sb = supabaseAdmin();
  const vec = await embedOne(draft, 'query');
  const { data: chunkRows } = await sb.rpc('match_chunks', {
    query_embedding: vec as unknown as string,
    match_count: 8,
    source_kinds: ['research_paper', 'coffee_book'],
    min_similarity: 0.35,
  });
  const chunks: AuditChunk[] = (chunkRows ?? []) as AuditChunk[];

  // 2) build the user content with evidence + the draft
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

  const userContent = `<context>${context}</context>
<evidence>
${evidenceBlock}
</evidence>
<draft>
${draft}
</draft>`;

  // 3) call Sonnet
  const res = await anthropic.messages.create({
    model: MODEL_GENERATE,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = res.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');

  const parsed = parseAuditJson(text);
  const tokens_in = res.usage?.input_tokens ?? 0;
  const tokens_out = res.usage?.output_tokens ?? 0;
  const cost_usd = (tokens_in * 3 + tokens_out * 15) / 1_000_000;

  return {
    draft_text: draft,
    context,
    compounds_detected: parsed.compounds_detected,
    mechanism_engaged: parsed.mechanism_engaged,
    bioavailability_engaged: parsed.bioavailability_engaged,
    evidence_engaged: parsed.evidence_engaged,
    practical_engaged: parsed.practical_engaged,
    weakest_link: parsed.weakest_link,
    regulatory_flags: parsed.regulatory_flags,
    evidence_tier: parsed.evidence_tier,
    suggested_rewrite: parsed.suggested_rewrite,
    reasoning: parsed.reasoning,
    cited_chunk_ids: parsed.cited_chunk_ids.length
      ? parsed.cited_chunk_ids
      : chunks.slice(0, 3).map((c) => c.id),
    cited_chunks: chunks,
    tokens_in,
    tokens_out,
    cost_usd,
    latency_ms: Date.now() - t0,
  };
}

type ParsedAudit = {
  compounds_detected: string[];
  mechanism_engaged: boolean;
  bioavailability_engaged: boolean;
  evidence_engaged: boolean;
  practical_engaged: boolean;
  weakest_link: ClaimAudit['weakest_link'];
  regulatory_flags: AuditFlag[];
  evidence_tier: number | null;
  suggested_rewrite: string;
  reasoning: string;
  cited_chunk_ids: string[];
};

function parseAuditJson(raw: string): ParsedAudit {
  const m = raw.match(/\{[\s\S]*\}/);
  const fallback: ParsedAudit = {
    compounds_detected: [],
    mechanism_engaged: false,
    bioavailability_engaged: false,
    evidence_engaged: false,
    practical_engaged: false,
    weakest_link: null,
    regulatory_flags: [],
    evidence_tier: null,
    suggested_rewrite: '',
    reasoning: 'audit JSON could not be parsed',
    cited_chunk_ids: [],
  };
  if (!m) return fallback;
  try {
    const j = JSON.parse(m[0]);
    return {
      compounds_detected: Array.isArray(j.compounds_detected) ? j.compounds_detected.map(String) : [],
      mechanism_engaged: Boolean(j.mechanism_engaged),
      bioavailability_engaged: Boolean(j.bioavailability_engaged),
      evidence_engaged: Boolean(j.evidence_engaged),
      practical_engaged: Boolean(j.practical_engaged),
      weakest_link: ['mechanism', 'bioavailability', 'evidence', 'practical'].includes(j.weakest_link)
        ? j.weakest_link
        : null,
      regulatory_flags: Array.isArray(j.regulatory_flags) ? j.regulatory_flags.map(String) as AuditFlag[] : [],
      evidence_tier: typeof j.evidence_tier === 'number' && j.evidence_tier >= 1 && j.evidence_tier <= 7
        ? Math.round(j.evidence_tier)
        : null,
      suggested_rewrite: String(j.suggested_rewrite ?? ''),
      reasoning: String(j.reasoning ?? ''),
      cited_chunk_ids: Array.isArray(j.cited_chunk_ids) ? j.cited_chunk_ids.map(String) : [],
    };
  } catch {
    return fallback;
  }
}
