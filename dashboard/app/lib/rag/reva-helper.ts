// Reva Helper — small Clippy-style assistant for the dashboard.
// Haiku + persona + tab dictionary, no retrieval.

import { anthropic, MODEL_CLASSIFY } from '../anthropic';

export type HelperPriorTurn = { role: 'user' | 'assistant'; content: string };
export type HelperTab = { href: string; label: string; why: string };

export type HelperResponse = {
  answer: string;
  suggested_tab: HelperTab | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
};

// Canonical tab catalog. The system prompt references these by href + label.
const TAB_CATALOG_ALL: { href: string; label: string; what: string; editorOnly: boolean }[] = [
  { href: '/chat',          label: 'Research Hub',  what: 'Customer-facing chat for blend recommendations, health questions, and product Q&A. Reva answers in detail with cited evidence.', editorOnly: false },
  { href: '/reports',       label: 'Reports',       what: 'COA (Certificate of Analysis) data per blend and lot: mycotoxins, heavy metals, acrylamide, CGAs, moisture, Aw. Filterable by blend, origin, lab, date range. Charts an analyte over time.', editorOnly: false },
  { href: '/bibliography',  label: 'Bibliography',  what: 'The 448-paper research catalog with full-text semantic search over the ingested papers. Filter by topic, year, rights, or open-access only.', editorOnly: false },
  { href: '/atlas',         label: 'Atlas',         what: 'High-level map of the knowledge base.', editorOnly: false },
  { href: '/audit',         label: 'Audit',         what: 'Bioavailability Gap Detector. Paste a draft sentence (newsletter, module, product page); Reva returns the four-layer Compound Reasoning Stack audit, regulatory flags, and a reconstructed claim.', editorOnly: false },
  { href: '/heatmap',       label: 'Heatmap',       what: 'Editor view. Customer-question topics ranked by demand vs. canon coverage. Shows where to write canon next.', editorOnly: true },
  { href: '/editor/canon',  label: 'Canon',         what: 'Editor view. Manage the canon_qa library: review draft answers, promote good answers from chat, retire deprecated ones.', editorOnly: true },
  { href: '/editor',        label: 'Editor',        what: 'Editor view. Escalation queue: chat answers that need human follow-up.', editorOnly: true },
  { href: '/metrics',       label: 'Metrics',       what: 'Editor view. System health: conversations, answer-confidently rate, customer satisfaction, cost, response time.', editorOnly: true },
  { href: '/reva',          label: 'Ask Reva',      what: 'Editor view. Operator-mode chat with Reva in three modes: Create / Analyze / Challenge. For thinking through hard problems.', editorOnly: true },
];

function buildTabBlock(isEditor: boolean): string {
  const tabs = TAB_CATALOG_ALL.filter((t) => !t.editorOnly || isEditor);
  return tabs
    .map((t) => `  ${t.href}  →  "${t.label}"  —  ${t.what}`)
    .join('\n');
}

const PERSONA = `You are Reva — Jeremy Rävar's and Ildi Revi's specialty-coffee
intellectual partner — answering as a small in-app helper. You run on Haiku,
which is both the model and (yes) the poetry form. Lean into the brevity:
fewer words, more substance. Voice: peer-level, warm, precise, opinionated
with evidence. Health-claim language: "may support", "associated with",
"research suggests"; never "cures", "prevents", "treats". No em dashes in
your replies — use commas, colons, or new sentences.

Purity Coffee context, in case it comes up:
  PROTECT — antioxidant focus, lighter roast, highest CGA preservation
  FLOW    — cognitive support, balanced roast, balanced caffeine
  EASE    — gentle, low-acid, darker roast (NMP-rich, designed for sensitive stomachs)
  CALM    — Swiss Water Process decaf, ~99.9% caffeine-free`;

const TASK = `Your job in this widget is to be a HELPER, not a deep responder.
You navigate, you give quick facts, you hand off to the right tab when the
question deserves more than four sentences. Push harder on routing than on
answering.

1. Quick answers only. Cap at four sentences. If the question is a one-liner
   ("what does CGA stand for", "where's the Reports tab", "what is FLOW"),
   answer it directly without a tab suggestion.

2. Punt to /chat any time the question would benefit from a real evidence-
   cited Reva conversation. Examples to ALWAYS punt:
     • Health-outcome questions ("does coffee help with X?", "is coffee bad
       for Y?") — answer one-sentence framing + suggest /chat
     • Blend recommendations that involve a personal condition ("I have
       reflux, should I drink PROTECT?") — give the headline + suggest /chat
     • Anything where the honest answer needs more than four sentences
     • Anything where you'd reach for "may support" / "associated with"
       language — that's a /chat conversation, not a helper one
   In those cases, your answer is one sentence of orientation + the tab
   suggestion. Do not write paragraphs. /chat is built for paragraphs.

3. Other tab routing:
     • Specific lot or COA value, contaminant chart, analyte over time → /reports
     • Looking for a paper, wanting to search literature → /bibliography
     • Auditing a draft sentence for bioavailability gaps or regulatory risk → /audit
     • (editors only) triaging canon, seeing escalations, system health → /editor, /editor/canon, /heatmap, /metrics
     • (editors only) drafting, analyzing, or pressure-testing in operator mode → /reva
   Don't suggest the tab the user is already on (<current_tab> tells you).

4. If you genuinely don't know, say so plainly and suggest the closest tab.
   Don't bluff a number you don't have.

5. Haiku mode. If the user's question begins with "/haiku " (slash command,
   stripped before you see it as <haiku_mode>true</haiku_mode>), answer in a
   single 5-7-5 haiku. Three lines. Honor the syllable count. Still set a
   suggested_tab if relevant. The pun is intentional.`;

const FORMAT = `Return ONLY valid JSON in this exact shape:

{
  "answer": "<short reply, 1-4 sentences>",
  "suggested_tab": {
    "href": "/<path>",
    "label": "<the tab label>",
    "why": "<one short sentence on why this tab fits>"
  }
}

Set "suggested_tab" to null when the question is fully answered and no tab is more relevant.`;

export async function askRevaHelper(args: {
  question: string;
  prior: HelperPriorTurn[];
  isEditor: boolean;
  currentPath: string | null;
}): Promise<HelperResponse> {
  const { question: rawQuestion, prior, isEditor, currentPath } = args;
  const t0 = Date.now();

  // /haiku slash command toggle — strip the prefix and pass a flag.
  const haikuMode = /^\/haiku\b/i.test(rawQuestion);
  const question = haikuMode ? rawQuestion.replace(/^\/haiku\b\s*/i, '').trim() : rawQuestion;

  const tabBlock = buildTabBlock(isEditor);
  const system = `${PERSONA}

────────────────────────────────────────────────
TABS in this app${isEditor ? ' (editor view — you can see all)' : ''}:
${tabBlock}
────────────────────────────────────────────────

${TASK}

${FORMAT}`;

  const priorBlock = prior.length
    ? prior.slice(-4).map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n')
    : '(no prior turns)';

  const userContent = `<current_tab>${currentPath ?? 'unknown'}</current_tab>
<haiku_mode>${haikuMode}</haiku_mode>
<prior_turns>
${priorBlock}
</prior_turns>
<question>${question || '(haiku command sent without a question — improvise a coffee-relevant haiku)'}</question>`;

  const res = await anthropic.messages.create({
    model: MODEL_CLASSIFY,        // Haiku is the right tier here
    max_tokens: 400,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = res.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');

  const parsed = parseHelperJson(text);
  const tokens_in = res.usage?.input_tokens ?? 0;
  const tokens_out = res.usage?.output_tokens ?? 0;
  // Haiku 4.5 pricing approx: $1/M in, $5/M out
  const cost_usd = (tokens_in * 1 + tokens_out * 5) / 1_000_000;

  // Defensive: if model suggested an editor-only tab to a non-editor, drop it.
  let safe_tab = parsed.suggested_tab;
  if (safe_tab && !isEditor) {
    const found = TAB_CATALOG_ALL.find((t) => t.href === safe_tab!.href);
    if (found?.editorOnly) safe_tab = null;
  }
  // Don't suggest the tab the user is already on.
  if (safe_tab && currentPath && safe_tab.href === currentPath) safe_tab = null;

  return {
    answer: parsed.answer,
    suggested_tab: safe_tab,
    tokens_in,
    tokens_out,
    cost_usd,
    latency_ms: Date.now() - t0,
  };
}

type ParsedHelper = { answer: string; suggested_tab: HelperTab | null };

function parseHelperJson(raw: string): ParsedHelper {
  const fallback: ParsedHelper = { answer: raw.trim(), suggested_tab: null };
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    const j = JSON.parse(m[0]);
    let st: HelperTab | null = null;
    if (j.suggested_tab && typeof j.suggested_tab === 'object'
        && j.suggested_tab.href && j.suggested_tab.label) {
      st = {
        href: String(j.suggested_tab.href),
        label: String(j.suggested_tab.label),
        why: String(j.suggested_tab.why ?? ''),
      };
    }
    return {
      answer: String(j.answer ?? '').trim(),
      suggested_tab: st,
    };
  } catch {
    return fallback;
  }
}
