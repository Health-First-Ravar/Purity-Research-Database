// Ask routing + lab retrieval eval. No UI, no chat log writes.
//
//   npm run eval:ask                 # routing + lab retrieval, live classifier
//   npm run eval:ask -- --answers    # also generate answers and check the guardrails
//   npm run eval:ask -- --only 7,9   # some cases (comma-separated ids; guardrail ids too)
//   npm run eval:ask -- --show       # print the lab evidence for each case
//   npm run eval:ask -- --answers --full   # print whole answers, not the first 220 characters
//   npm run eval:ask -- --answers --guard  # only the guardrail prompts
//
// Runs the same functions /api/chat uses (classify, detectLabQuestion,
// fetchLabEvidence, askRoute, labLinksFor) against the live database with the
// service-role key, simulating an admin (elevated) or customer service viewer.
// Exit code 1 when any assertion fails. Run it before every push.

import { createClient } from '@supabase/supabase-js';
import { classify, type Classification } from '../lib/rag/classify';
import { detectLabQuestion, fetchLabEvidence, type LabChunk } from '../lib/rag/lab-lookup';
import { askRoute, labLinksFor, type AskRoute } from '../lib/rag/ask-route';
import { generateAnswer } from '../lib/rag/generate';
import { guardrailViolations } from '../lib/rag/guardrails';

type Case = {
  id: string;
  q: string;
  viewer?: 'admin' | 'cs';
  route: AskRoute;
  panel: boolean;
  /** Every lab link label must mention one of these (or be a COA quick view link). */
  linksAbout?: string[];
  /** Evidence (all lab chunks joined) must contain each of these. */
  evidenceHas?: (string | RegExp)[];
  evidenceLacks?: (string | RegExp)[];
  panelHas?: (string | RegExp)[];
  /** Extra answer checks for --answers. */
  answerHas?: (string | RegExp)[];
};

const CORE5 = ['EASE', 'PROTECT', 'BALANCE', 'CALM', 'FLOW'];

const CASES: Case[] = [
  { id: '6', q: "What were PROTECT's latest mycotoxin results?", route: 'COA', panel: true, linksAbout: ['PROTECT'],
    evidenceHas: [/Deoxynivalenol \(DON\).*LOQ above limit/], panelHas: ['PROTECT'] },
  { id: '7', q: 'Which products are over a limit right now?', route: 'COA', panel: true,
    evidenceHas: ['CURRENT LAB STATUS BY PRODUCT', 'Over the limit'], evidenceLacks: [/\blot (number|code)\b/i] },
  { id: '8', q: 'Show me report 98765432', route: 'COA', panel: false, evidenceHas: ['no record you can see matches'] },
  { id: '9', q: 'What do the latest green coffee results show?', route: 'COA', panel: true, linksAbout: ['Green'],
    evidenceHas: ['GREEN COFFEE LOTS', 'Green Arabica Requirements v2.5'] },
  { id: '9cs', q: 'What do the latest green coffee results show?', viewer: 'cs', route: 'COA', panel: false,
    evidenceHas: ['not available in this view'], evidenceLacks: ['GREEN COFFEE LOTS'] },
  { id: '10', q: 'Does FLOW meet the CGA standard?', route: 'COA', panel: true, linksAbout: ['FLOW'],
    evidenceHas: ['2.35', /no finished-product .*minimum/i, /green/i] },
  { id: '11', q: 'What lab results came in this week?', route: 'COA', panel: true,
    evidenceHas: ['2026-10-07', ...CORE5.map((p) => new RegExp(`\\b${p}\\b.*2026-10-07|2026-10-07.*\\b${p}\\b`))], panelHas: CORE5 },
  { id: '12', q: 'Is CALM tested for mold?', route: 'COA', panel: true, linksAbout: ['CALM'], panelHas: ['CALM'] },
  { id: '13', q: 'How can coffee help me stay calm and focused?', route: 'Research', panel: false },
  { id: '14', q: 'What does research suggest about chlorogenic acids and glucose metabolism?', route: 'Research', panel: false,
    answerHas: [/research suggests|may|associated with/i] },
  { id: '7b', q: 'Is anything near a limit right now?', route: 'COA', panel: true, evidenceHas: ['CURRENT LAB STATUS BY PRODUCT'] },
  { id: 'n1', q: 'Which blends cause stomach problems?', route: 'Research', panel: false },
];

// Guardrail prompts (item 6): the answer must pass guardrailViolations().
const GUARD: { id: string; q: string }[] = [
  { id: 'g1', q: 'If PROTECT came back over a limit, would it still ship?' },
  { id: 'g2', q: 'Can you let me know when new lab results post?' },
  { id: 'g3', q: 'Who does the CGA testing for Purity?' },
  { id: 'g4', q: 'Does FLOW help with focus and energy?' },
  { id: 'g5', q: 'What are the latest acrylamide results for EASE?' },
];

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;

function env(k: string): string {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}. Run with --env-file=.env.local.`); process.exit(2); }
  return v;
}

const test = (hay: string, n: string | RegExp) => (typeof n === 'string' ? hay.includes(n) : n.test(hay));

async function main() {
  const db = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  let failures = 0;
  const cases = CASES.filter((c) => (!only || only.has(c.id)) && !flag('--guard'));
  for (const c of cases) {
    const cls: Classification = await classify(c.q);
    const signals = detectLabQuestion(c.q, cls);
    // Service role bypasses RLS; the elevated flag applies the same kind allowlist RLS does for customer service.
    const lab: LabChunk[] = await fetchLabEvidence(db, signals, c.viewer !== 'cs');
    const route = askRoute(signals, cls, lab.length > 0);
    const panel = lab.find((x) => x.panel)?.panel ?? null;
    const links = labLinksFor(lab);
    const evidence = lab.map((x) => `${x.title}\n${x.content}`).join('\n\n');
    const panelText = panel ? JSON.stringify(panel) : '';
    const errs: string[] = [];
    if (route !== c.route) errs.push(`route ${route}, expected ${c.route}`);
    if (!!panel !== c.panel) errs.push(`lab_panel ${panel ? 'present' : 'absent'}, expected ${c.panel ? 'present' : 'absent'}`);
    if (!panel && links.length) errs.push(`lab_links without a panel: ${links.map((l) => l.label).join(' | ')}`);
    if (c.linksAbout) {
      const off = links.filter((l) => !l.url.startsWith('/coa') && !c.linksAbout!.some((p) => l.label.includes(p)));
      if (off.length) errs.push(`unrelated lab_links: ${off.map((l) => l.label).join(' | ')}`);
    }
    for (const n of c.evidenceHas ?? []) if (!test(evidence, n)) errs.push(`evidence missing ${n}`);
    for (const n of c.evidenceLacks ?? []) if (test(evidence, n)) errs.push(`evidence should not contain ${n}`);
    for (const n of c.panelHas ?? []) if (!test(panelText, n)) errs.push(`panel missing ${n}`);

    let answerNote = '';
    if (flag('--answers')) {
      const res = await generateAnswer({ question: c.q, chunks: lab, classification: cls, prior: [] });
      const v = guardrailViolations(res.answer);
      if (v.length) errs.push(`guardrails: ${v.join('; ')}`);
      for (const n of c.answerHas ?? []) if (!test(res.answer, n)) errs.push(`answer missing ${n}`);
      if (c.id === '7' && res.escalation_recommended) errs.push('escalated');
      answerNote = `\n    answer: ${flag('--full') ? res.answer : `${res.answer.replace(/\s+/g, ' ').slice(0, 220)}...`}`;
    }

    failures += errs.length ? 1 : 0;
    console.log(`${errs.length ? 'FAIL' : 'pass'}  [${c.id}] ${c.q}  -> ${route}${panel ? `, panel "${panel.title ?? panel.product}" (${panel.rows.length} rows)` : ''}${links.length ? `, ${links.length} links` : ''}  (cls ${cls.category})`);
    for (const e of errs) console.log(`    ✗ ${e}`);
    if (flag('--show')) console.log(evidence.split('\n').map((l) => `    | ${l}`).join('\n'), links.map((l) => `\n    > ${l.label} ${l.url}`).join(''));
    if (answerNote) console.log(answerNote);
  }

  if (flag('--answers')) {
    for (const g of GUARD.filter((x) => !only || only.has(x.id))) {
      const cls = await classify(g.q);
      const signals = detectLabQuestion(g.q, cls);
      const lab = await fetchLabEvidence(db, signals, true);
      const res = await generateAnswer({ question: g.q, chunks: lab, classification: cls, prior: [] });
      const v = guardrailViolations(res.answer);
      failures += v.length ? 1 : 0;
      console.log(`${v.length ? 'FAIL' : 'pass'}  [${g.id}] ${g.q}`);
      for (const e of v) console.log(`    ✗ ${e}`);
      console.log(`    answer: ${flag('--full') ? res.answer : `${res.answer.replace(/\s+/g, ' ').slice(0, 260)}...`}`);
    }
  }

  console.log(failures ? `\n${failures} case(s) failed.` : '\nAll cases passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
