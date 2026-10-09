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
import { stripDashes } from './sanitize';
import { CUSTOMER_EXCLUDED_TYPES, type SourceType } from './source-classify';

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
  /** sources.metadata.source_type (review, primary_study, book, ...) when classified. */
  source_type?: string | null;
};

/**
 * Bumped whenever the prompt, flag rules or retrieval change. /api/audit reuses
 * a stored audit of the same draft and context only from the same version.
 */
export const AUDITOR_VERSION = '2026-10-09.3';

export type ClaimAudit = {
  auditor_version: string;
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

Regulatory flags. Raise a flag ONLY when its definition fits the draft's own
wording. A draft that names its compound, hedges its health effect ("research
suggests", "may support", "associated with") and makes a claim the evidence
supports gets NO flags.
  cure_word / prevent_word / treat_word: the draft itself contains that word
      (cure, prevent, treat, or a form of it). Never raise one for a word that
      is not in the draft.
  cures_disease: says the coffee cures, prevents, treats or mitigates a disease.
  overstated_effect: states a health effect as certain, large or proven
      ("boosts", "will lower", "proven to").
  single_roast_overclaim: says one roast level is healthier overall, or that the
      roast alone delivers a health outcome. NOT for a factual statement of how
      a coffee is roasted or what its roast retains ("roasted to retain
      chlorogenic acids" is a process fact).
  in_vitro_to_human_jump: a cell or animal finding stated as a human effect.
  observational_as_causal: an association stated as cause and effect.
  unfalsifiable_clean_claim: "clean", "toxin-free", "purest" with no measure.
  organic_equals_healthier: organic presented as a health effect in itself.
  bioavailability_assumed: a definite effect in the body from a compound's
      presence in the cup ("delivers CGAs to your cells"). A hedged "research
      suggests ... may support" statement does not get this flag.
  unspecified_compound: a health effect credited to "antioxidants" or
      "compounds" without naming them.
  unspecified_dose: a definite, dose-dependent effect with no amount.

Evidence tier (1..7): judge it from the evidence chunks you cite, not from
memory. It is the tier of the strongest cited human evidence that bears
DIRECTLY on the draft's health outcome: 1 pre-registered RCT, 2 systematic
review or meta-analysis of human studies, 3 prospective cohort, 4
cross-sectional or retrospective, 5 mechanistic human (pharmacokinetics,
bioavailability), 6 animal, 7 in vitro. A review that does not cover the
draft's outcome does not count. null when no cited chunk bears on the outcome.

The suggested rewrite keeps the draft's subject and its factual statements (for
example how Purity roasts its coffee). Change only what does not hold up. If
the draft already holds up, return it with at most light edits. A rewrite is a
composition, process or hedged structure/function statement: it never names a
disease and never links a Purity product to a disease or to disease risk (talk
about what research on coffee or a compound suggests, and keep the product to
what it contains or how it is made).

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
  "suggested_rewrite": "<the version that holds up, one or two sentences, keeping the draft's subject. Use 'may support', 'associated with', 'research suggests'; never 'cures', 'prevents', 'treats'. Never name a disease or condition (no liver disease, fibrosis, cancer, diabetes, dementia) and never state a risk reduction or a percentage: say what research suggests a compound may support (for example 'may support liver health'). No superlatives or marketing adjectives. Never use em dashes or en dashes; use commas, colons, or periods.>",
  "reasoning": "<one or two sentences explaining the audit; editor log>",
  "cited_chunk_ids": ["<uuid>", ...]
}`;

export async function auditClaim(args: {
  draft: string;
  context: AuditContext;
}): Promise<ClaimAudit> {
  const { draft, context } = args;
  const t0 = Date.now();

  // 1) retrieve evidence: research_paper + coffee_book only.
  const chunks = await retrieveAuditEvidence(draft);

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
  // temperature 0: the same draft and evidence should get the same tier and
  // flags (identical runs returned tier 3 and then 4).
  const res = await anthropic.messages.create({
    model: MODEL_GENERATE,
    max_tokens: 1500,
    temperature: 0,
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
    auditor_version: AUDITOR_VERSION,
    draft_text: draft,
    context,
    compounds_detected: parsed.compounds_detected,
    mechanism_engaged: parsed.mechanism_engaged,
    bioavailability_engaged: parsed.bioavailability_engaged,
    evidence_engaged: parsed.evidence_engaged,
    practical_engaged: parsed.practical_engaged,
    weakest_link: parsed.weakest_link,
    regulatory_flags: wordFlagsInText(parsed.regulatory_flags, draft),
    evidence_tier: parsed.evidence_tier,
    suggested_rewrite: stripDashes(parsed.suggested_rewrite),
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

// The three word flags name a word in the draft. The model raised CURE WORD and
// TREAT WORD on "prevents liver disease", where only "prevents" appears; keep
// a word flag only when its word is actually there.
const WORD_FLAG_RE: Partial<Record<AuditFlag, RegExp>> = {
  cure_word: /\bcur(?:e|es|ed|ing|ative)\b/i,
  prevent_word: /\bprevent(?:s|ed|ing|ion|ive|ative)?\b/i,
  treat_word: /\btreat(?:s|ed|ing|ment|ments)?\b/i,
};

export function wordFlagsInText(flags: AuditFlag[], draft: string): AuditFlag[] {
  return [...new Set(flags)].filter((f) => !WORD_FLAG_RE[f] || WORD_FLAG_RE[f]!.test(draft));
}

// ---------------------------------------------------------------------------
// Evidence retrieval
// ---------------------------------------------------------------------------

// What a claim is about: compounds and health outcomes, as plain search terms.
const COMPOUND_TERMS: [RegExp, string][] = [
  [/\bchlorogenic|\bCGAs?\b/i, 'chlorogenic acids'], [/\bmelanoidins?\b/i, 'melanoidins'], [/\btrigonelline\b/i, 'trigonelline'],
  [/\bNMP\b|methylpyridinium/i, 'N-methylpyridinium'], [/\bcaffeine\b/i, 'caffeine'], [/\bcafestol|kahweol|diterpenes?\b/i, 'diterpenes'],
  [/\bacrylamide\b/i, 'acrylamide'], [/\bochratoxin|\bOTA\b|mycotoxins?\b/i, 'mycotoxins'], [/\bpolyphenols?\b|antioxidants?\b/i, 'polyphenols antioxidants'],
];
const OUTCOME_TERMS: [RegExp, string][] = [
  [/\bglucose|blood sugar|glyc(?:a)?emic|insulin|diabet\w*/i, 'glucose metabolism insulin type 2 diabetes'],
  [/\bliver|hepat\w*/i, 'liver'], [/\bcogniti\w*|dementia|alzheimer\w*|memory|brain|focus\b/i, 'cognition'],
  [/\bgut\b|microbio\w*|digest\w*|reflux|stomach|gastric/i, 'gut digestion'], [/\binflammat\w*/i, 'inflammation'],
  [/\bheart|cardio\w*|blood pressure|cholesterol/i, 'cardiovascular'], [/\bsleep\b/i, 'sleep'], [/\bweight|obes\w*|metabolic\b/i, 'weight metabolic'],
  [/\bcancer\w*/i, 'cancer'], [/\bmood|depress\w*/i, 'mood depression'],
];

const terms = (text: string, table: [RegExp, string][]) => table.filter(([re]) => re.test(text)).map(([, t]) => t);

/**
 * Evidence for a draft. The draft's own embedding favours chunks that sound
 * like it (brand copy, the coffee book's general chapters), so a glucose claim
 * got "Coffee, Dementia and Cognition" first. This adds a second query built
 * from the compounds and outcomes the draft names, drops sources that are not
 * science (marketing, media, certificates, competitors: the same filter as
 * Ask), and reranks by similarity plus how many of the draft's outcome and
 * compound terms a chunk mentions. Deterministic for a given draft.
 */
async function retrieveAuditEvidence(draft: string): Promise<AuditChunk[]> {
  const sb = supabaseAdmin();
  const outcomes = terms(draft, OUTCOME_TERMS);
  const compounds = terms(draft, COMPOUND_TERMS);
  const queries = [draft];
  if (outcomes.length) queries.push(`${compounds.join(' ')} ${outcomes.join(' ')} coffee`.trim());
  const pools = await Promise.all(queries.map(async (q) => {
    const vec = await embedOne(q, 'query');
    const { data } = await sb.rpc('match_chunks', {
      query_embedding: vec as unknown as string,
      match_count: 20,
      source_kinds: ['research_paper', 'coffee_book'],
      min_similarity: 0.35,
    });
    return (data ?? []) as AuditChunk[];
  }));
  const byId = new Map<string, AuditChunk>();
  for (const c of pools.flat()) {
    const prev = byId.get(c.id);
    if (!prev || c.similarity > prev.similarity) byId.set(c.id, c);
  }
  const all = [...byId.values()];
  const ids = [...new Set(all.map((c) => c.source_id))];
  const types = new Map<string, string | null>();
  if (ids.length) {
    const { data } = await sb.from('sources').select('id, metadata').in('id', ids);
    for (const s of (data ?? []) as { id: string; metadata: Record<string, unknown> | null }[]) {
      types.set(s.id, (s.metadata?.source_type as string | undefined) ?? null);
    }
  }
  const outcomeRes = OUTCOME_TERMS.filter(([re]) => re.test(draft)).map(([re]) => re);
  const compoundRes = COMPOUND_TERMS.filter(([re]) => re.test(draft)).map(([re]) => re);
  // A term in the title or heading says what the source is about; in the body
  // it may be a passing mention (a dementia review that mentions diabetes).
  const score = (c: AuditChunk) => {
    const head = `${c.title} ${c.heading ?? ''}`;
    const hits = (res: RegExp[], text: string) => res.filter((re) => re.test(text)).length;
    return c.similarity
      + 0.06 * hits(outcomeRes, head) + 0.015 * hits(outcomeRes, c.content)
      + 0.01 * hits(compoundRes, head) + 0.005 * hits(compoundRes, c.content);
  };
  return all
    .map((c) => ({ ...c, source_type: types.get(c.source_id) ?? null }))
    .filter((c) => !c.source_type || !CUSTOMER_EXCLUDED_TYPES.has(c.source_type as SourceType))
    // Blank pages and parser boilerplate are not evidence (same rule as Ask).
    .filter((c) => { const t = (c.content ?? '').replace(/\s+/g, ' ').trim(); return t.length >= 20 && !/this page (is )?intentionally left blank/i.test(`${c.title} ${t}`); })
    .sort((a, b) => score(b) - score(a) || b.similarity - a.similarity || a.id.localeCompare(b.id))
    .slice(0, 8);
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

/** Thrown when the model's audit response cannot be parsed.
 *
 *  This used to return an all-false fallback carrying
 *  `reasoning: 'audit JSON could not be parsed'`, which the caller then
 *  persisted to `claim_audits` like any real result. In the Recent-audits list
 *  a parse failure was indistinguishable from a claim that engaged no layers
 *  and raised no regulatory flags — i.e. from a clean pass.
 *
 *  On regulated health claims a silent pass is the worst available failure
 *  mode. Same reasoning as RevaSkillUnavailableError above: refuse loudly
 *  rather than answer from an unconfigured state. */
export class AuditUnparseableError extends Error {
  constructor(raw: string) {
    super(
      'The claim auditor returned a response that could not be parsed as JSON, ' +
        'so no audit was performed. Nothing was saved. Try again. ' +
        `First 200 characters of the response: ${raw.slice(0, 200)}`,
    );
    this.name = 'AuditUnparseableError';
  }
}

function parseAuditJson(raw: string): ParsedAudit {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new AuditUnparseableError(raw);
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
  } catch (e) {
    if (e instanceof AuditUnparseableError) throw e;
    throw new AuditUnparseableError(raw);
  }
}
