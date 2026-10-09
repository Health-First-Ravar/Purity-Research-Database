// Lab results for Ask, from Brian's Lab Testing tracker (lab_results, synced).
//
// The Hub's COA source is Brian's tracker. For any question about lab testing,
// this leg reads lab_results on the CALLER's client (RLS: customer service sees
// finished products only) and hands the model a small set of authoritative
// evidence blocks built with the same scoring the COA quick view uses
// (lib/lab-status.ts), so Ask and the quick view can never disagree.
//
// Competitor records are never used here, for any role: Ask does not quote
// another brand's lab data (brand rule in generate.ts).
//
// Selection is structural, not semantic: products, analytes, report numbers,
// "which lots are over" and "most recent" are all exact lookups over the rows.

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  analyteLabel, analyteStatus, buildStandard, CORE, display, isFullPanel, isSacredCups, LABEL, latestFor, MATRIX,
  panelState, PRODUCT_ORDER, RANK, recordLabel, recordStatus,
  type LabRecord, type Standard, type Status, type StdRow,
} from '../lab-status';

export type LabLink = { label: string; url: string };

/**
 * A compact result panel for the UI, in Brian's status chips: one product's
 * latest result per analyte, or (when `who` is set on the rows) one row per
 * product or lot, as in the all-products status and tested-in-a-window views.
 */
export type LabPanel = {
  product: string;
  title?: string;
  href: string;
  note?: string;
  rows: { key?: string; who?: string; code: string; label: string; value: string; status: Status; text: string; date: string }[];
};

export type LabChunk = {
  id: string;
  source_id: string;
  heading: string | null;
  content: string;
  similarity: number;
  kind: string;
  title: string;
  chapter: string | null;
  via: 'lab_tracker';
  links: LabLink[];
  panel?: LabPanel;
};

/** A test-date window named in the question ("this week", "last 30 days", "since Sept 1"). Inclusive ISO dates. */
export type DateWindow = { from: string; to: string; label: string };

export type LabSignals = {
  fire: boolean;
  products: string[];
  codes: string[];
  reportTokens: string[];
  aggregate: boolean;
  status: boolean;       // "which products are over / near a limit right now": latest result per product and analyte
  recency: boolean;
  window: DateWindow | null;
  research: boolean;     // asks about research, studies or evidence and names no product, lot, report or lab result
  green: boolean;        // green coffee lots (staff only)
  year: string | null;   // "this year" / an explicit 20xx
};

// ---------------------------------------------------------------------------
// Question signals
// ---------------------------------------------------------------------------

// `weak` words are everyday English too ("lead to", "clean label", "caffeine
// and sleep"); they only count alongside a product name or a lab word.
const ANALYTE_WORDS: { re: RegExp; codes: string[]; weak?: boolean }[] = [
  { re: /\bheavy[-\s]?metals?\b/i, codes: ['Pb', 'Cd', 'As', 'Hg'] },
  { re: /\bmetals\b/i, codes: ['Pb', 'Cd', 'As', 'Hg'], weak: true },
  { re: /\blead\b|\bpb\b/i, codes: ['Pb'], weak: true },
  { re: /\bcadmium\b/i, codes: ['Cd'] },
  { re: /\barsenic\b/i, codes: ['As'] },
  { re: /\bmercury\b/i, codes: ['Hg'] },
  { re: /\bmycotoxins?\b/i, codes: ['OTA', 'AFB1', 'AFT', 'DON', 'FUM', 'ZEN', 'T2'] },
  { re: /\btoxins?\b/i, codes: ['OTA', 'AFB1', 'AFT', 'DON', 'FUM', 'ZEN', 'T2'], weak: true },
  { re: /\bochratoxin|\bOTA\b/i, codes: ['OTA'] },
  { re: /\baflatoxins?\b|\bafb1\b/i, codes: ['AFB1', 'AFT'] },
  { re: /\bdeoxynivalenol\b|\bvomitoxin\b|\bDON\b/, codes: ['DON'] },
  { re: /\bfumonisins?\b/i, codes: ['FUM'] },
  { re: /\bzearalenone\b/i, codes: ['ZEN'] },
  { re: /\bt-?2 toxin\b/i, codes: ['T2'] },
  { re: /\bacrylamide\b/i, codes: ['ACR'] },
  { re: /\bpesticides?\b|\bherbicides?\b/i, codes: ['GLY', 'AMPA', 'OPP'] },
  { re: /\bresidues?\b/i, codes: ['GLY', 'AMPA', 'OPP'], weak: true },
  { re: /\bglyphosate\b|\broundup\b/i, codes: ['GLY', 'AMPA'] },
  { re: /\b(?:2-|ortho-?)?phenylphenol\b/i, codes: ['OPP'] },
  { re: /\bmou?lds?\b|\byeasts?\b|\bmicrobial\b/i, codes: ['YST', 'MLD'], weak: true },
  { re: /\bplate count\b/i, codes: ['APC'] },
  { re: /\bgluten\b/i, codes: ['GLU'], weak: true },
  { re: /\bchlorogenic\b|\bCGAs?\b/i, codes: ['CGA'] },
  { re: /\bpolyphenols?\b|\bphenolics?\b/i, codes: ['CGA', 'TPC'], weak: true },
  { re: /\bcaffeine\b/i, codes: ['CAF'], weak: true },
  { re: /\btrigonelline\b/i, codes: ['TRIG'] },
  { re: /\bmoisture\b/i, codes: ['MOI'], weak: true },
  { re: /\bwater activity\b/i, codes: ['AW'] },
  { re: /\bantioxidants?\b|\bTEAC\b|\bORAC\b/i, codes: ['TEAC', 'TPC', 'CGA'], weak: true },
  { re: /\bagtron\b|\broast colou?r\b/i, codes: ['AGTRON'], weak: true },
  { re: /\bcontaminants?\b|\bcontamination\b|\bimpurit(?:y|ies)\b|\bclean(?:est)?\b/i, codes: MATRIX.filter((c) => c !== 'CGA'), weak: true },
];

// A lab/testing context word. Deliberately narrow: "levels", "results",
// "reports" and "a lot" are everyday words in health questions.
const LAB_CTX =
  /\b(coas?|certificates?(?: of analysis)?|lab(?:oratory|s)?|lab results?|tested|testing|tests?|test results?|ppb|ppm|panels?|assays?|batch(?:es)?|samples?|lot (?:number|code|#)|(?:green|coffee) lots?|lots? (?:tested|over|under|below|above|failed|flagged))\b/i;
const RECENCY = /\b(most[-\s]?recent|recent(?:ly)?|latest|newest|new|last|current(?:ly)?|up[-\s]?to[-\s]?date|came in|come in|posted)\b/i;
const AGG_INTENT = /\b(which|any|list|how\s+many|are\s+there|show|find|ever)\b/i;
const OVER = /\b(exceed(?:s|ed|ing)?|over|above|fail(?:s|ed|ing|ures?)?|breach(?:es|ed)?|outside|flagged|problems?|issues?|out of spec)\b/i;
const LIMIT_WORD = /\b(limits?|spec|standard|threshold|health grade|minimum|floor)\b/i;
const UNDER = /\b(below|under|short of|lower than|less than|missed)\b/i;
// All-products status ("which products are over a limit right now", "is anything
// near a limit"). Narrower than OVER: "which blends cause stomach problems" is
// not a lab question.
const PRODUCTS_PLURAL =
  /\b(?:which|what|any|all|list|show)\b[^.?!]{0,30}\b(?:products?|blends?|coffees?|skus?)\b|\banything\b|\bany of (?:our|the|your) (?:products|blends|coffees)\b|\b(?:our|the|all|your) (?:products|blends|coffees)\b/i;
const OVER_STATUS = /\b(over|above|exceed(?:s|ed|ing)?|fail(?:s|ed|ing)?|flagged|out of spec|within)\b/i;
const NEAR = /\b(near(?:ly)?|close to|approaching)\b/i;
const HISTORY = /\b(ever|history|historically|in the past|previous(?:ly)?|all[-\s]time)\b/i;
const REPORT_TOKEN = /\b(?:[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|\d{5,})\b/g;
const TOKEN_STOP = new Set(['covid-19', 'omega-3', 'omega-6', 'b12', 'sars-cov-2']);

// Research questions go to Research even when they name an analyte ("what does
// research suggest about chlorogenic acids and glucose metabolism"), unless
// they also name a product, lot, report or lab result.
const RESEARCH = /\b(research|stud(?:y|ies)|evidence|literature|science|scientific|papers?|clinical|trials?|meta-?analys[ie]s|journals?|peer[-\s]reviewed)\b/i;
const LAB_NAMED = /\b(coas?|certificates?(?: of analysis)?|lab(?:oratory)?\s+(?:results?|tests?|testing|reports?|data)|test results?|our (?:lab|labs|testing|tests|results)|lots?|batch(?:es)?|panels?|reports?)\b/i;

const DAY = 86400000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const NUM_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30, sixty: 60, ninety: 90 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Monday of the ISO week containing `today`. */
function weekStart(today: string): number {
  const t = Date.parse(`${today}T00:00:00Z`);
  return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
}

/** A test-date window named in the question, or null. `today` is an ISO date. */
export function detectWindow(q: string, today: string): DateWindow | null {
  const t = Date.parse(`${today}T00:00:00Z`);
  if (/\btoday\b/i.test(q)) return { from: today, to: today, label: 'today' };
  if (/\byesterday\b/i.test(q)) { const d = isoDay(t - DAY); return { from: d, to: d, label: 'yesterday' }; }
  if (/\bthis week\b/i.test(q)) return { from: isoDay(weekStart(today)), to: today, label: 'this week' };
  if (/\blast week\b/i.test(q)) { const s = weekStart(today) - 7 * DAY; return { from: isoDay(s), to: isoDay(s + 6 * DAY), label: 'last week' }; }
  if (/\bthis month\b/i.test(q)) return { from: `${today.slice(0, 8)}01`, to: today, label: 'this month' };
  if (/\blast month\b/i.test(q)) {
    const first = Date.parse(`${today.slice(0, 8)}01T00:00:00Z`);
    const prevEnd = first - DAY;
    return { from: `${isoDay(prevEnd).slice(0, 8)}01`, to: isoDay(prevEnd), label: 'last month' };
  }
  const n = q.match(/\b(?:past|last|previous)\s+(\d{1,3}|two|three|four|five|six|seven|ten|fourteen|thirty|sixty|ninety)\s+(days?|weeks?|months?)\b/i);
  if (n) {
    const k = /^\d+$/.test(n[1]) ? Number(n[1]) : NUM_WORDS[n[1].toLowerCase()];
    const days = k * (/^week/i.test(n[2]) ? 7 : /^month/i.test(n[2]) ? 30 : 1);
    return { from: isoDay(t - days * DAY), to: today, label: `the last ${k} ${n[2].toLowerCase()}` };
  }
  const since = q.match(/\bsince\s+(\d{4}-\d{2}-\d{2}|([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?|(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)\b/i);
  if (since) {
    let from: string | null = null;
    if (/^\d{4}-/.test(since[1])) from = since[1];
    else if (since[2]) {
      const m = MONTHS.indexOf(since[2].slice(0, 3).toLowerCase());
      if (m >= 0) {
        let y = since[4] ? Number(since[4]) : Number(today.slice(0, 4));
        const d = `${y}-${String(m + 1).padStart(2, '0')}-${String(Number(since[3])).padStart(2, '0')}`;
        if (!since[4] && d > today) y -= 1;
        from = `${y}-${String(m + 1).padStart(2, '0')}-${String(Number(since[3])).padStart(2, '0')}`;
      }
    } else if (since[5]) {
      let y = since[7] ? Number(since[7].length === 2 ? `20${since[7]}` : since[7]) : Number(today.slice(0, 4));
      const d = `${y}-${since[5].padStart(2, '0')}-${since[6].padStart(2, '0')}`;
      if (!since[7] && d > today) y -= 1;
      from = `${y}-${since[5].padStart(2, '0')}-${since[6].padStart(2, '0')}`;
    }
    if (from && !Number.isNaN(Date.parse(`${from}T00:00:00Z`))) return { from, to: today, label: `since ${from}` };
  }
  return null;
}

// Blend names that are also everyday words ("balance blood sugar", "calm
// nerves", "go with the flow") only count as a product when written as a
// name (FLOW, or Flow mid-sentence) or next to a product word.
const AMBIGUOUS = new Set(['FLOW', 'EASE', 'CALM', 'PROTECT', 'BALANCE', 'ORIGINAL', 'DECAF', 'FOUNDERS', 'HEARTH', 'ESPRESSO', 'COLD BREW', 'DARK ROAST', 'STAR DAY']);
const PRODUCT_WORD = '(?:blend|coffee|roast|beans?|pods?|bag|whole bean|ground|by purity)';

function mentionsProduct(p: string, question: string): boolean {
  const name = p.replace(/\s+/g, '[-\\s]?');
  if (!AMBIGUOUS.has(p)) return new RegExp(`\\b${name}\\b`, 'i').test(question);
  if (new RegExp(`\\b${name}\\b`).test(question)) return true; // ALL CAPS, as Purity writes its blends
  const title = p.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, '[-\\s]?');
  if (new RegExp(`[^.!?\\s]\\s+${title}\\b`).test(question)) return true; // "Is Flow tested", not sentence-initial
  return new RegExp(`\\b${name}\\s+${PRODUCT_WORD}\\b|\\bpurity\\s+${name}\\b`, 'i').test(question);
}

export function detectLabQuestion(
  question: string,
  cls: { category?: string; blend?: string | null } = {},
  today: string = new Date().toISOString().slice(0, 10),
): LabSignals {
  const products = PRODUCT_ORDER.filter((p) => mentionsProduct(p, question));
  if (cls.blend && !products.includes(cls.blend)) products.push(cls.blend);
  const labCtx = LAB_CTX.test(question);
  const anchored = labCtx || products.length > 0;
  const codes = [...new Set(ANALYTE_WORDS.filter((w) => w.re.test(question) && (!w.weak || anchored)).flatMap((w) => w.codes))];
  const reportTokens = [...new Set((question.match(REPORT_TOKEN) ?? []).map((t) => t.replace(/[^A-Za-z0-9-]/g, '')))]
    .filter((t) => t.length >= 5 && (t.match(/\d/g) ?? []).length >= 4 && !TOKEN_STOP.has(t.toLowerCase()))
    .slice(0, 5);
  // Current status across products: latest result per product and analyte, the
  // same view as the COA quick view grid. Not for a named product (that is the
  // product block) and not for history ("ever", "previously": the record scan).
  const status =
    products.length === 0 && reportTokens.length === 0 && !HISTORY.test(question) &&
    PRODUCTS_PLURAL.test(question) && (OVER_STATUS.test(question) || NEAR.test(question)) &&
    (LIMIT_WORD.test(question) || codes.length > 0 || labCtx);
  const aggregate =
    !status && AGG_INTENT.test(question) && (OVER.test(question) || UNDER.test(question) || LIMIT_WORD.test(question)) && (labCtx || codes.length > 0);
  // "latest green coffee results", "green lots over the limit". Not "is green
  // coffee extract good for weight loss": a result, lot or test word is needed.
  const green = /\bgreen\b/i.test(question) && (labCtx || codes.length > 0 ||
    (/\bgreen[-\s](?:coffee|lots?|beans?|samples?)\b/i.test(question) && /\b(results?|lots?|tests?|tested|testing|data|scores?|scored|requirements?|grades?|graded)\b/i.test(question)));
  const yr = question.match(/\b(20\d\d)\b/);
  const year = /\bthis year\b/i.test(question) ? new Date().toISOString().slice(0, 4) : yr ? yr[1] : null;
  const recency = RECENCY.test(question) && labCtx;
  // A test-date window counts only for a lab question ("how was your week" is not).
  const win = detectWindow(question, today);
  const dateWin = win && (labCtx || codes.length > 0 || products.length > 0 || green) ? win : null;
  const research = RESEARCH.test(question) && products.length === 0 && reportTokens.length === 0 && !LAB_NAMED.test(question) && !green;
  const coa = cls.category === 'coa';
  // Product alone ("is PROTECT good for reflux?") is not a lab question; a
  // product plus a lab word or an analyte is.
  const fire = !research && (
    codes.length > 0 || reportTokens.length > 0 || aggregate || status || recency || !!dateWin || coa ||
    (products.length > 0 && labCtx) || green);
  return { fire, products, codes, reportTokens, aggregate, status, recency, window: dateWin, research, green, year };
}

// ---------------------------------------------------------------------------
// Evidence blocks (pure: unit-testable without a database)
// ---------------------------------------------------------------------------

const MAX_PRODUCTS = 3;
const MAX_LIST = 40;

const iso = (d?: string | null) => (d ? d.slice(0, 10) : 'undated');
const slug = (p: string) => p.toLowerCase().replace(/\s+/g, '-');
const label = (std: Standard, code: string) => std.finished[code]?.label ?? code;
const unit = (std: Standard, code: string) => std.finished[code]?.unit ?? '';

function limitText(std: Standard, code: string, rec?: LabRecord): string {
  const g = rec?.sample_type === 'green' ? std.green[code] : undefined;
  const d = g ?? std.finished[code];
  if (!d) return 'no Health Grade limit';
  const u = d.unit || unit(std, code);
  switch (d.rule) {
    case 'ceiling': return `${g ? 'green limit' : 'limit'} ${g ? '<' : '≤'} ${d.value} ${u}`;
    case 'floor': return `${g ? 'green minimum' : 'minimum'} ≥ ${d.value} ${u}`;
    case 'not_detectable': return 'limit: not detectable';
    case 'flag_detected': return 'flagged if detected';
    default: return 'no Health Grade limit (informational)';
  }
}

/** Set-aside marker; the reason can hold internal notes, so only staff see it. */
const notScored = (r: LabRecord, elevated: boolean) =>
  r.excluded ? ` · NOT SCORED (set aside${elevated && r.excluded_reason ? `: ${r.excluded_reason}` : ''})` : '';

function recWho(r: LabRecord): string {
  const what = r.kind === 'product' ? (r.product || r.name || 'product') : `${r.name || r.id} (${r.kind === 'green' ? 'green lot' : r.kind})`;
  const ids = [r.report_number && `report ${r.report_number}`, r.sample_number && `sample ${r.sample_number}`].filter(Boolean).join(', ');
  return `${what} · ${r.lab ?? 'lab not recorded'}${ids ? ` · ${ids}` : ''}`;
}

// Panel groups named as such; other groups are named by their analytes.
const GROUP_WORDS: Record<string, string> = {
  'Heavy metals': 'heavy metals', Mycotoxins: 'mycotoxins', Residues: 'pesticide residues', Micro: 'yeast and mold',
};

/** What a record tested, in words: "full contaminant panel", or "mycotoxins", "heavy metals, acrylamide". */
function coverage(r: LabRecord, std: Standard): string {
  const parts: string[] = [];
  for (const c of Object.keys(r.analytes || {})) {
    const g = std.finished[c]?.grp ?? '';
    const w = GROUP_WORDS[g] ?? (std.finished[c]?.label ?? c).toLowerCase();
    if (!parts.includes(w)) parts.push(w);
  }
  const what = parts.slice(0, 5).join(', ') + (parts.length > 5 ? ` and ${parts.length - 5} more` : '');
  return isFullPanel(r) ? `full contaminant panel (${what})` : what || 'no analytes recorded';
}

/** Status wording for evidence; spells out the two labels that read ambiguously out of context. */
function statusText(status: string, text: string): string {
  if (status === 'info') return 'measured (no limit applies)';
  if (status === 'incon') return "LOQ above limit (the lab's reporting limit sat above our limit; nothing was detected)";
  if (status === 'cleared') return 'Cleared on retest (first result over or near the limit, retest within the limit)';
  return text;
}

/** Overall record status, naming the analytes that set it when it is not clean. */
function overall(r: LabRecord, std: Standard): string {
  const rl = recordLabel(r, std);
  const text = statusText(rl.status, rl.label);
  if (!['fail', 'watch', 'incon', 'cleared', 'detect'].includes(rl.status)) return text;
  const which = Object.keys(r.analytes || {}).filter((c) => analyteStatus(r, c, std)?.status === rl.status);
  return which.length ? `${text}, set by ${which.map((c) => label(std, c)).join(', ')}` : text;
}

function readingLine(r: LabRecord, code: string, std: Standard): string | null {
  const a = analyteStatus(r, code, std);
  if (!a) return null;
  const v = display(a.reading);
  return `${label(std, code)} (${code}): ${v}${v ? ` ${unit(std, code)}` : ''}, ${limitText(std, code, r)} → ${statusText(a.status, analyteLabel(a))}`;
}

/**
 * Certificate links, labelled with what each certificate covers, so an older
 * full-panel certificate is never mistaken for the newest result's (the Oct 7
 * mycotoxin panels have no certificate; PROTECT's link is its 2025 full panel).
 */
function certLinks(recs: LabRecord[], std: Standard, max = 4, lastFull?: LabRecord): LabLink[] {
  const out: LabLink[] = [];
  const seen = new Set<string>();
  for (const r of recs) {
    if (!r.certificate_url || seen.has(r.certificate_url)) continue;
    seen.add(r.certificate_url);
    const who = r.product || r.name || r.id;
    const label = r === lastFull ? `Last full-panel certificate: ${who} (${iso(r.test_date)})`
      : isFullPanel(r) ? `Full-panel certificate: ${who} (${iso(r.test_date)})`
      : `Certificate: ${who}, ${coverage(r, std)} (${iso(r.test_date)})`;
    out.push({ label, url: r.certificate_url });
    if (out.length >= max) break;
  }
  return out;
}

function chunk(title: string, content: string, links: LabLink[]): LabChunk {
  return {
    id: randomUUID(), source_id: 'lab-tracker', heading: null, content, similarity: 1,
    kind: 'coa', title, chapter: null, via: 'lab_tracker', links,
  };
}

/**
 * For analytes asked about that have no finished-product limit but do have a
 * green-coffee requirement (CGA and caffeine minimums), say so, so "does FLOW
 * meet the CGA standard" is answered against the right standard.
 */
function greenOnlyNotes(codes: string[], std: Standard): string[] {
  const out: string[] = [];
  for (const c of codes) {
    const f = std.finished[c];
    const g = std.green[c];
    if (!g || g.value == null || (f && f.rule !== 'informational')) continue;
    const req = g.rule === 'floor' ? `minimum of ${g.value}${g.unit === '%' ? '%' : ` ${g.unit}`}` : g.rule === 'ceiling' ? `limit below ${g.value} ${g.unit}` : null;
    if (!req) continue;
    out.push(`Standard for ${label(std, c)}: there is no finished-product ${g.rule === 'floor' ? 'minimum' : 'limit'} for ${label(std, c)} in the Purity Health Grade, so a roasted blend's value is reported, not scored. The ${req} applies to green coffee (${g.version ?? 'Green Arabica requirements'}), not to finished products.`);
  }
  return out;
}

function productBlock(p: string, recs: LabRecord[], std: Standard, codes: string[], today: string, syncedAt: string, elevated: boolean): LabChunk | null {
  const mine = recs.filter((r) => r.kind === 'product' && r.product === p);
  if (!mine.length) return null;
  const tested = mine.filter((r) => r.status !== 'Awaiting sample');
  const ps = panelState(p, recs, today);
  const want = codes.length ? codes : MATRIX;
  const lines: string[] = [];
  const used: LabRecord[] = [];
  const missing: string[] = [];
  const panelRows: LabPanel['rows'] = [];
  for (const c of want) {
    const r = latestFor(recs, p, c);
    if (!r) { missing.push(label(std, c)); continue; }
    const line = readingLine(r, c, std);
    if (!line) continue;
    const a = analyteStatus(r, c, std);
    if (a) {
      const v = display(a.reading);
      panelRows.push({ code: c, label: label(std, c), value: v ? `${v} ${unit(std, c)}`.trim() : '', status: a.status, text: analyteLabel(a), date: iso(r.test_date) });
    }
    lines.push(`- ${line} · tested ${iso(r.test_date)} · ${recWho(r)}${notScored(r, elevated)}`);
    if (!used.includes(r)) used.push(r);
    if (codes.length) {
      // Asked about specifically: show the earlier results too, so a trend or a
      // retest is visible instead of one number out of context.
      const earlier = tested.filter((x) => x !== r && x.analytes?.[c]).slice(0, 4);
      for (const x of earlier) {
        const a = analyteStatus(x, c, std);
        if (a) lines.push(`  - earlier: ${display(a.reading)} ${unit(std, c)} → ${statusText(a.status, analyteLabel(a))} · tested ${iso(x.test_date)} · ${x.lab ?? 'lab'}`);
      }
    }
  }
  const first = tested[tested.length - 1]?.test_date;
  const last = tested[0]?.test_date;
  const panel =
    ps.status === 'exempt' ? 'Sacred Cups results are not scored against the Purity Health Grade (separate brand).'
    : ps.full ? `${ps.label}: last full contaminant panel (metals, mycotoxins, acrylamide) ${iso(ps.full.test_date)} at ${ps.full.lab ?? 'lab'}; next due ${ps.due}.`
    : `${ps.label}.`;
  const content = [
    `LAB RESULTS FOR ${p} (Purity Lab Testing tracker, synced ${iso(syncedAt)}). Authoritative for ${p}'s lab testing; statuses use the Purity Health Grade limits.`,
    // SOP compliance (panel overdue, sample at the lab) is internal; staff only.
    ...(elevated
      ? [`Testing status (internal, staff only): ${panel}${ps.pending ? ` A new sample was sent to the lab on ${iso(ps.pending.test_date)} and is awaiting results.` : ''}`]
      : ps.status === 'exempt' ? [panel] : []),
    `Latest result per analyte (value, limit → status, test date, lab):`,
    ...(lines.length ? lines : ['- (no results on file for the analytes asked about)']),
    ...(missing.length ? [`Not tested on file for ${p}: ${missing.join(', ')}. Do not estimate these.`] : []),
    ...greenOnlyNotes(codes, std),
    `Records on file for ${p}: ${tested.length} test record(s) from ${iso(first)} to ${iso(last)}.`,
  ].join('\n');
  const out = chunk(`Lab Testing tracker: ${p}`, content, [{ label: `COA quick view: ${p}`, url: `/coa/${slug(p)}` }, ...certLinks(used, std, 4, ps.full)]);
  if (panelRows.length) out.panel = { product: p, href: `/coa/${slug(p)}`, rows: panelRows };
  return out;
}

function analyteAcrossProducts(codes: string[], recs: LabRecord[], std: Standard, syncedAt: string): LabChunk | null {
  const products = [...new Set(recs.filter((r) => r.kind === 'product' && r.product).map((r) => r.product as string))]
    .sort((a, b) => (PRODUCT_ORDER.indexOf(a) + 1 || 99) - (PRODUCT_ORDER.indexOf(b) + 1 || 99));
  const lines: string[] = [];
  const used: LabRecord[] = [];
  for (const c of codes.slice(0, 8)) {
    const rows: string[] = [];
    for (const p of products) {
      const r = latestFor(recs, p, c);
      if (!r) continue;
      const a = analyteStatus(r, c, std);
      if (!a) continue;
      rows.push(`  - ${p}: ${display(a.reading)} ${unit(std, c)} → ${statusText(a.status, analyteLabel(a))} (tested ${iso(r.test_date)}, ${r.lab ?? 'lab'})`);
      used.push(r);
    }
    lines.push(`${label(std, c)} (${c}), ${limitText(std, c)}:`, ...(rows.length ? rows : ['  - no finished-product results on file']));
  }
  if (!lines.length) return null;
  const content = [
    `LAB RESULTS BY PRODUCT (Purity Lab Testing tracker, synced ${iso(syncedAt)}). Latest finished-product result for each analyte asked about; statuses use the Purity Health Grade limits.`,
    ...lines,
  ].join('\n');
  return chunk(`Lab Testing tracker: ${codes.slice(0, 3).map((c) => label(std, c)).join(', ')} by product`, content, certLinks(used, std, 3));
}

function overLimitQuery(codes: string[], recs: LabRecord[], std: Standard, syncedAt: string, elevated: boolean): LabChunk {
  const scope = recs.filter((r) => r.status !== 'Awaiting sample');
  const want = codes.length ? codes : Object.keys(std.finished);
  type Hit = { r: LabRecord; c: string; line: string; status: string };
  const over: Hit[] = [], near: Hit[] = [], cleared: Hit[] = [], loq: Hit[] = [], detected: Hit[] = [];
  for (const r of scope) {
    if (r.excluded) continue;
    for (const c of want) {
      const a = analyteStatus(r, c, std);
      if (!a || a.floor) continue;
      const h = { r, c, status: a.status, line: `- ${iso(r.test_date)} · ${recWho(r)} · ${label(std, c)} ${display(a.reading)} ${unit(std, c)} (${limitText(std, c, r)}) → ${statusText(a.status, analyteLabel(a))}` };
      if (a.status === 'fail') over.push(h);
      else if (a.status === 'watch') near.push(h);
      else if (a.status === 'cleared') cleared.push(h);
      else if (a.status === 'incon') loq.push(h);
      else if (a.status === 'detect') detected.push(h);
    }
  }
  const what = codes.length ? codes.map((c) => label(std, c)).join(', ') : 'any contaminant';
  const who = elevated ? 'all non-competitor records (finished products, green lots, R&D)' : 'finished products';
  const content = [
    `STRUCTURED LAB QUERY (authoritative and complete for ${who} in the Purity Lab Testing tracker, synced ${iso(syncedAt)}).`,
    `Query: results for ${what} over or near (above 80% of) the Purity Health Grade limit, or detected where any detection is flagged.`,
    `Result: ${over.length} over the limit, ${near.length} near the limit, ${detected.length} detected where any detection is flagged (glyphosate, AMPA), ${cleared.length} over or near the limit on the first test but within the limit on retest, ${loq.length} where the lab's reporting limit sat above our limit (not a detection).`,
    `Any record not listed below is within the limit, not detected, or not tested for ${what}.`,
    ...(over.length ? ['Over the limit:', ...over.slice(0, MAX_LIST).map((h) => h.line)] : ['Over the limit: none.']),
    ...(near.length ? ['Near the limit:', ...near.slice(0, MAX_LIST).map((h) => h.line)] : []),
    ...(detected.length ? ['Detected (flagged if detected, no numeric limit):', ...detected.slice(0, MAX_LIST).map((h) => h.line)] : []),
    ...(cleared.length ? ['Cleared on retest:', ...cleared.slice(0, 15).map((h) => h.line)] : []),
  ].join('\n');
  return chunk(`Lab Testing tracker query: ${what} against the Health Grade limits`, content, []);
}

/** Finished products with lab data, in PRODUCT_ORDER, then any others alphabetically (as the COA quick view grid). */
function productsOnFile(recs: LabRecord[]): string[] {
  const s = new Set(recs.filter((r) => r.kind === 'product' && r.product).map((r) => r.product as string));
  return [...PRODUCT_ORDER.filter((p) => s.has(p)), ...[...s].filter((p) => !PRODUCT_ORDER.includes(p)).sort()];
}

const STATUS_GROUPS: { status: Status; heading: string }[] = [
  { status: 'fail', heading: 'Over the limit' },
  { status: 'watch', heading: 'Near the limit (above 80% of the limit)' },
  { status: 'detect', heading: 'Detected where any detection is flagged (no numeric limit)' },
  { status: 'cleared', heading: 'Cleared on retest (first result over or near the limit, retest within it)' },
  { status: 'incon', heading: "LOQ above limit (nothing detected; the lab's reporting limit sat above our limit)" },
];

/**
 * Current status across all finished products: the latest result for each
 * product and analyte, scored with the Health Grade rules. This is the COA
 * quick view grid (latestFor x analyteStatus), so Ask and the grid agree.
 */
function statusBlock(codes: string[], recs: LabRecord[], std: Standard, today: string, syncedAt: string, elevated: boolean): LabChunk {
  const products = productsOnFile(recs);
  // Every analyte with a finished-product limit, not only the grid's columns:
  // DON, fumonisins and the rest are scored the same way and count here too.
  const limited = Object.keys(std.finished).filter((c) => ['ceiling', 'not_detectable', 'flag_detected'].includes(std.finished[c].rule));
  const want = codes.length ? codes : limited;
  type Hit = { p: string; c: string; r: LabRecord; a: NonNullable<ReturnType<typeof analyteStatus>> };
  const hits: Hit[] = [];
  const clean: string[] = [];
  const notScoredProducts: string[] = [];
  for (const p of products) {
    let flagged = false;
    let scored = false;
    for (const c of want) {
      const r = latestFor(recs, p, c);
      if (!r) continue;
      const a = analyteStatus(r, c, std);
      if (!a) continue;
      if (a.status === 'exempt' || a.status === 'excluded') continue;
      scored = true;
      if (a.floor) continue;
      if (STATUS_GROUPS.some((g) => g.status === a.status)) hits.push({ p, c, r, a });
      // Over, near or detected is a problem; cleared on retest and LOQ above limit are not.
      if (a.status === 'fail' || a.status === 'watch' || a.status === 'detect') flagged = true;
    }
    if (!scored) notScoredProducts.push(p);
    else if (!flagged) clean.push(p);
  }
  const what = codes.length ? codes.map((c) => label(std, c)).join(', ') : 'every analyte with a Health Grade limit';
  const lines: string[] = [];
  for (const g of STATUS_GROUPS) {
    const gh = hits.filter((h) => h.a.status === g.status);
    if (!gh.length) { if (g.status === 'fail') lines.push('Over the limit: none.'); continue; }
    lines.push(`${g.heading}:`);
    for (const h of gh.slice(0, MAX_LIST)) {
      const v = display(h.a.reading);
      lines.push(`- ${h.p} · ${label(std, h.c)} ${v}${v ? ` ${unit(std, h.c)}` : ''} (${limitText(std, h.c, h.r)}) · tested ${iso(h.r.test_date)} · ${h.r.lab ?? 'lab not recorded'}`);
    }
  }
  // Staff also see green lots on Home's "Needs attention"; point to them, never list them as products.
  let greenLine = '';
  if (elevated) {
    const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 730 * 86400000).toISOString().slice(0, 10);
    const g = recs.filter((r) => r.kind === 'green' && r.status !== 'Awaiting sample' && !r.excluded && (r.test_date ?? '') >= cutoff
      && Object.keys(r.analytes || {}).some((c) => { const a = analyteStatus(r, c, std); return !!a && !a.floor && (a.status === 'fail' || a.status === 'watch'); }));
    greenLine = `Green coffee lots are not products and are not counted above. Staff note: ${g.length} green lot record(s) tested in the last 24 months have a result over or near a green limit (see Green lots in the COA quick view).`;
  }
  const count = (st: Status) => hits.filter((h) => h.a.status === st).length;
  const content = [
    `CURRENT LAB STATUS BY PRODUCT (authoritative and complete for finished products in the Purity Lab Testing tracker, synced ${iso(syncedAt)}). For each product and analyte this uses the LATEST result on file, as the COA quick view grid does, scored against the Purity Health Grade limits.`,
    `Query: ${what}, latest result per product. Products checked (${products.length}): ${products.join(', ')}.`,
    `Result: ${count('fail')} over the limit, ${count('watch')} near the limit, ${count('detect')} detected where any detection is flagged, ${count('cleared')} cleared on retest, ${count('incon')} LOQ above limit (not a detection).`,
    ...lines,
    clean.length ? `No latest result over or near a limit, or detected: ${clean.join(', ')}.` : '',
    notScoredProducts.length ? `Not scored against the Health Grade: ${notScoredProducts.join(', ')}.` : '',
    greenLine,
    'This is the current status only. It does not say what was done with any lot; do not describe holds, releases or shipping decisions.',
  ].filter(Boolean).join('\n');
  const ordered = STATUS_GROUPS.flatMap((g) => hits.filter((h) => h.a.status === g.status));
  const rows: LabPanel['rows'] = ordered.slice(0, 24).map((h) => {
    const v = display(h.a.reading);
    return { key: `${h.p}-${h.c}`, who: h.p, code: h.c, label: label(std, h.c), value: v ? `${v} ${unit(std, h.c)}`.trim() : '', status: h.a.status, text: analyteLabel(h.a), date: iso(h.r.test_date) };
  });
  if (!rows.length) {
    for (const p of clean) rows.push({ key: p, who: p, code: '', label: 'latest results', value: '', status: 'pass', text: 'Within limit', date: '' });
  }
  const flaggedProducts = [...new Set(ordered.filter((h) => ['fail', 'watch', 'detect'].includes(h.a.status)).map((h) => h.p))].slice(0, 5);
  const out = chunk(`Lab Testing tracker: current status, all products`, content, [
    { label: 'COA quick view', url: '/coa' },
    ...flaggedProducts.map((p) => ({ label: `COA quick view: ${p}`, url: `/coa/${slug(p)}` })),
  ]);
  out.panel = {
    product: 'All products',
    title: 'All products: latest result per analyte',
    href: '/coa',
    note: ordered.length ? `${clean.length} of ${products.length} products have no latest result over or near a limit.` : undefined,
    rows,
  };
  return out;
}

function reportBlock(tokens: string[], recsIn: LabRecord[], std: Standard, syncedAt: string, elevated: boolean): LabChunk {
  // Samples still at the lab are internal; customer service only sees results.
  const recs = elevated ? recsIn : recsIn.filter((r) => r.status !== 'Awaiting sample');
  const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const hits = recs.filter((r) =>
    tokens.some((t) => {
      const k = norm(t);
      return [r.report_number, r.sample_number, r.order_number].some((f) => norm(f) && (norm(f).includes(k) || k.includes(norm(f)) && norm(f).length >= 5));
    }),
  ).slice(0, 4);
  if (!hits.length) {
    return chunk('Lab Testing tracker: report lookup', `LAB RECORD LOOKUP (Purity Lab Testing tracker, synced ${iso(syncedAt)}): no record you can see matches report/sample/order number ${tokens.join(', ')}. Do not guess its results.`, []);
  }
  const parts = hits.map((r) => {
    const rl = recordLabel(r, std);
    const lines = Object.keys(r.analytes || {})
      .map((c) => readingLine(r, c, std))
      .filter(Boolean)
      .map((l) => `  - ${l}`);
    return [
      `${recWho(r)} · tested ${iso(r.test_date)} · overall: ${r.status === 'Awaiting sample' ? 'awaiting results' : overall(r, std)}${notScored(r, elevated)}`,
      ...lines,
    ].join('\n');
  });
  const content = [`LAB RECORD LOOKUP by report/sample number (Purity Lab Testing tracker, synced ${iso(syncedAt)}):`, ...parts].join('\n');
  return chunk(`Lab Testing tracker: ${[...new Set(hits.map((r) => r.report_number || r.sample_number || r.id))].join(', ')}`, content, certLinks(hits, std));
}

function recentBlock(recs: LabRecord[], std: Standard, syncedAt: string, products: string[], elevated: boolean): LabChunk {
  const scope = recs.filter((r) => r.status !== 'Awaiting sample' && (!products.length || products.includes(r.product ?? '')));
  const top = scope.slice(0, 6);
  const lines = top.map((r) => {
    const keys = Object.keys(r.analytes || {}).filter((c) => MATRIX.includes(c));
    const summary = keys.slice(0, 6).map((c) => `${c} ${display(analyteStatus(r, c, std)?.reading)}`).join(', ');
    return `- ${iso(r.test_date)} · ${recWho(r)} · tested: ${coverage(r, std)} · overall: ${overall(r, std)}${summary ? ` · ${summary}` : ''}`;
  });
  const pending = elevated ? recs.filter((r) => r.status === 'Awaiting sample' && (!products.length || products.includes(r.product ?? ''))) : [];
  const content = [
    `MOST RECENT LAB RESULTS (Purity Lab Testing tracker, synced ${iso(syncedAt)}), newest first by test date. A partial panel (for example mycotoxins only) is a new result: report it.`,
    ...(lines.length ? lines : ['- none on file']),
    ...(pending.length ? [`Samples sent and awaiting results: ${pending.map((r) => `${r.product || r.name} (sent ${iso(r.test_date)})`).join(', ')}.`] : []),
  ].join('\n');
  return chunk('Lab Testing tracker: most recent results', content, certLinks(top, std, 3));
}

function overviewBlock(recs: LabRecord[], std: Standard, today: string, syncedAt: string, elevated: boolean): LabChunk {
  const head = `LAB TESTING OVERVIEW (Purity Lab Testing tracker, synced ${iso(syncedAt)}). Finished blends are tested by third-party labs for heavy metals, mycotoxins, acrylamide, glyphosate, yeast and mold; results are scored against the Purity Health Grade limits.`;
  const lines = CORE.map((p) => {
    const tested = recs.filter((r) => r.kind === 'product' && r.product === p && r.status !== 'Awaiting sample');
    if (!tested.length) return `- ${p}: no results on file`;
    const latest = `most recent test ${iso(tested[0].test_date)} (${coverage(tested[0], std)}, ${tested[0].lab ?? 'lab'}; overall ${overall(tested[0], std)})`;
    if (elevated) {
      const ps = panelState(p, recs, today);
      return `- ${p}: ${latest}; full panel status: ${ps.label}${ps.full ? ` (last full panel ${iso(ps.full.test_date)}, ${ps.full.lab ?? 'lab'})` : ''}${ps.pending ? `; new sample awaiting results since ${iso(ps.pending.test_date)}` : ''}`;
    }
    const contam = MATRIX.filter((c) => c !== 'CGA').map((c) => latestFor(recs, p, c)).filter(Boolean) as LabRecord[];
    const worst = contam.map((r) => recordLabel(r, std)).sort((a, b) => RANK[b.status] - RANK[a.status])[0];
    return `- ${p}: ${latest}; latest contaminant results overall: ${worst ? statusText(worst.status, worst.label) : 'none on file'}`;
  });
  const note = 'The five core blends are FLOW, EASE, CALM, PROTECT and BALANCE: cover all five. A partial panel (for example mycotoxins only) is a new result even when the last full panel is older; never say no new results came in when one is listed above.';
  return chunk('Lab Testing tracker: testing overview', [head, ...lines, note].join('\n'), [{ label: 'COA quick view', url: '/coa' }]);
}

/** Every record with a test date in the window, across products (and, for staff, green and R&D lots). */
function windowBlock(win: DateWindow, signals: LabSignals, recs: LabRecord[], std: Standard, syncedAt: string, elevated: boolean): LabChunk {
  const inWin = (r: LabRecord) => { const d = iso(r.test_date); return d >= win.from && d <= win.to; };
  const want = (r: LabRecord) =>
    (!signals.products.length || signals.products.includes(r.product ?? '')) && (!signals.green || r.kind === 'green');
  const scope = recs.filter((r) => inWin(r) && r.status !== 'Awaiting sample' && want(r));
  const pending = elevated ? recs.filter((r) => inWin(r) && r.status === 'Awaiting sample' && want(r)) : [];
  const lines = scope.slice(0, MAX_LIST).map((r) =>
    `- ${iso(r.test_date)} · ${recWho(r)} · tested: ${coverage(r, std)} · overall: ${overall(r, std)}${notScored(r, elevated)}`);
  const core = signals.products.length || signals.green ? [] : CORE.map((p) => {
    const mine = scope.filter((r) => r.kind === 'product' && r.product === p);
    return mine.length
      ? `- ${p}: ${mine.map((r) => `${coverage(r, std)} (${iso(r.test_date)}, ${r.lab ?? 'lab'}; ${overall(r, std)})`).join('; ')}`
      : `- ${p}: no results with a test date in this window`;
  });
  const who = elevated ? 'finished products, green lots and R&D samples' : 'finished products';
  const content = [
    `LAB RESULTS BY TEST DATE, ${win.label} (${win.from} to ${win.to}) (Purity Lab Testing tracker, synced ${iso(syncedAt)}). Complete for ${who}: every record with a test date in this window is listed, newest first. A partial panel (for example mycotoxins only) is a new result: report it.`,
    `Result: ${scope.length} record(s) with a test date in this window.`,
    ...(lines.length ? lines : ['- none']),
    ...(scope.length > MAX_LIST ? [`(${scope.length - MAX_LIST} more not shown)`] : []),
    ...(core.length ? ['Core blends in this window (list all five):', ...core] : []),
    ...(pending.length ? [`Samples sent in this window and awaiting results (staff only): ${pending.map((r) => `${r.product || r.name} (sent ${iso(r.test_date)})`).join(', ')}.`] : []),
  ].join('\n');
  const out = chunk(`Lab Testing tracker: results ${win.label}`, content, [
    { label: 'COA quick view', url: '/coa' },
    ...certLinks(scope, std, 4),
  ]);
  if (scope.length) {
    out.panel = {
      product: `Tested ${win.label}`,
      title: `Tested ${win.label} (${win.from} to ${win.to})`,
      href: signals.green ? '/coa/green' : '/coa',
      rows: scope.slice(0, 24).map((r) => {
        const st = recordStatus(r, std);
        return {
          key: r.id, who: r.kind === 'product' ? (r.product || r.name || r.id) : (r.name || r.id), code: '',
          label: coverage(r, std), value: '', status: st, text: recordLabel(r, std).label, date: iso(r.test_date),
        };
      }),
    };
  }
  return out;
}

function greenBlock(signals: LabSignals, recs: LabRecord[], std: Standard, syncedAt: string): LabChunk {
  const codes = signals.codes.length ? signals.codes : Object.keys(std.green);
  const scope = recs.filter((r) => r.kind === 'green' && r.status !== 'Awaiting sample' && (!signals.year || (r.test_date ?? '').startsWith(signals.year)));
  type Worst = { c: string; a: NonNullable<ReturnType<typeof analyteStatus>> };
  type Row = { r: LabRecord; parts: string[]; flagged: boolean; worst: Worst | null };
  const rows: Row[] = [];
  for (const r of scope) {
    const parts: string[] = [];
    let flagged = false;
    let worst: Worst | null = null;
    for (const c of codes) {
      const a = analyteStatus(r, c, std);
      if (!a) continue;
      const bad = a.floor || a.status === 'fail' || a.status === 'watch';
      flagged ||= bad;
      if (!worst || RANK[a.status] > RANK[worst.a.status]) worst = { c, a };
      parts.push(`${label(std, c)} ${display(a.reading)} ${unit(std, c)} (${limitText(std, c, r)}) → ${statusText(a.status, analyteLabel(a))}`);
    }
    if (parts.length) rows.push({ r, parts, flagged, worst });
  }
  const list = signals.aggregate ? rows.filter((x) => x.flagged) : rows;
  const what = codes.map((c) => label(std, c)).join(', ');
  const content = [
    `GREEN COFFEE LOTS (staff only; Purity Lab Testing tracker, synced ${iso(syncedAt)}). Scored against ${std.green[codes[0]]?.version ?? 'the Green Arabica requirements'}. Below a minimum (CGA, caffeine) is flagged for review, not failed, because labs report CGA on different bases.`,
    `Scope: ${rows.length} green lot record(s)${signals.year ? ` tested in ${signals.year}` : ''} with results for ${what}; ${rows.filter((x) => x.flagged).length} flagged (over or near a limit, or below a minimum).`,
    signals.aggregate ? 'Flagged lots (complete list for this scope):' : 'Lots, newest first:',
    ...(list.length ? list.slice(0, MAX_LIST).map((x) => `- ${iso(x.r.test_date)} · ${recWho(x.r)}${notScored(x.r, true)}: ${x.parts.join('; ')}`) : ['- none']),
    ...(list.length > MAX_LIST ? [`(${list.length - MAX_LIST} more not shown)`] : []),
  ].join('\n');
  const out = chunk(`Lab Testing tracker: green lots${signals.year ? ` ${signals.year}` : ''}`, content, [{ label: 'Green lots', url: '/coa/green' }]);
  if (list.length) {
    out.panel = {
      product: 'Green lots',
      title: signals.aggregate ? 'Green lots: flagged' : 'Green lots: newest first',
      href: '/coa/green',
      note: `Scored against ${std.green[codes[0]]?.version ?? 'the Green Arabica requirements'}. ${rows.filter((x) => x.flagged).length} of ${rows.length} lot record(s) flagged.`,
      rows: list.slice(0, 12).map((x) => {
        const w = x.worst!;
        const v = display(w.a.reading);
        return {
          key: x.r.id, who: x.r.name || x.r.id, code: w.c, label: label(std, w.c), value: v ? `${v} ${unit(std, w.c)}`.trim() : '',
          status: w.a.status, text: analyteLabel(w.a), date: iso(x.r.test_date),
        };
      }),
    };
  }
  return out;
}

/**
 * Build the evidence blocks for a lab question from already-loaded rows.
 * `recs` must be newest first and already limited to what the caller may see.
 */
export function buildLabChunks(
  signals: LabSignals,
  recsIn: LabRecord[],
  std: Standard,
  opts: { today: string; syncedAt: string; elevated: boolean },
): LabChunk[] {
  // Competitors never enter Ask; customer service sees finished products only.
  const allowed = opts.elevated ? ['product', 'green', 'rd', 'roasted-other'] : ['product'];
  const recs = recsIn.filter((r) => allowed.includes(r.kind));
  if (!recs.length) return [];
  const out: LabChunk[] = [];

  if (signals.reportTokens.length) {
    out.push(reportBlock(signals.reportTokens, recs, std, opts.syncedAt, opts.elevated));
  }
  const green = opts.elevated && signals.green;
  if (green) out.push(greenBlock(signals, recs, std, opts.syncedAt));
  if (signals.status) out.push(statusBlock(signals.codes, recs, std, opts.today, opts.syncedAt, opts.elevated));
  if (signals.aggregate && !green) out.push(overLimitQuery(signals.codes, recs, std, opts.syncedAt, opts.elevated));
  if (signals.green && !opts.elevated) {
    out.push(chunk('Lab Testing tracker: green coffee', 'Green coffee lot results are internal to the Purity team and are not available in this view. Finished-product results are.', []));
  }
  const known = signals.products.filter((p) => recs.some((r) => r.kind === 'product' && r.product === p)).slice(0, MAX_PRODUCTS);
  for (const p of known) {
    const b = productBlock(p, recs, std, signals.codes, opts.today, opts.syncedAt, opts.elevated);
    if (b) out.push(b);
  }
  if (!known.length && signals.codes.length && !signals.aggregate && !signals.status && !green) {
    const b = analyteAcrossProducts(signals.codes, recs, std, opts.syncedAt);
    if (b) out.push(b);
  }
  if (signals.window) out.push(windowBlock(signals.window, signals, recs, std, opts.syncedAt, opts.elevated));
  else if (signals.recency) out.push(recentBlock(recs, std, opts.syncedAt, known, opts.elevated));
  if (!out.length) out.push(overviewBlock(recs, std, opts.today, opts.syncedAt, opts.elevated));
  return out;
}

// ---------------------------------------------------------------------------
// Database read
// ---------------------------------------------------------------------------

/**
 * Fetch lab evidence for a question. Runs on the caller's client so RLS applies;
 * returns [] on any error so Ask degrades to plain retrieval instead of failing.
 */
export async function fetchLabEvidence(
  client: SupabaseClient,
  signals: LabSignals,
  elevated: boolean,
): Promise<LabChunk[]> {
  if (!signals.fire) return [];
  try {
    // Allowlist, so a new kind (or a third-party sample not yet reclassified)
    // fails closed: competitor records never reach Ask for any role.
    const kinds = elevated ? ['product', 'green', 'rd', 'roasted-other'] : ['product'];
    const [{ data: rows, error }, { data: stdRows, error: e2 }] = await Promise.all([
      fetchAll(client, kinds),
      client.from('lab_standard').select('*'),
    ]);
    if (error) throw error;
    if (e2) throw e2;
    const recs = (rows ?? []) as (LabRecord & { synced_at: string })[];
    if (!recs.length) return [];
    const syncedAt = recs.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), recs[0].synced_at);
    return buildLabChunks(signals, recs, buildStandard((stdRows ?? []) as StdRow[]), {
      today: new Date().toISOString().slice(0, 10),
      syncedAt,
      elevated,
    });
  } catch (e) {
    console.error('[lab-lookup] failed, continuing without lab evidence:', e);
    return [];
  }
}

const LAB_COLS = 'id, kind, product, name, description, sample_type, status, test_date, lab, analytes, certificate_url, order_number, report_number, sample_number, excluded, excluded_reason, synced_at';

/** Every visible row, paged past PostgREST's per-request cap (1,000 by default). */
async function fetchAll(client: SupabaseClient, kinds: string[]): Promise<{ data: LabRecord[] | null; error: unknown }> {
  const out: LabRecord[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await client
      .from('lab_results').select(LAB_COLS).in('kind', kinds)
      .order('test_date', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
      .range(from, from + 999);
    if (error) return { data: null, error };
    out.push(...((data ?? []) as LabRecord[]));
    if ((data ?? []).length < 1000) break;
  }
  return { data: out, error: null };
}

/** Ask uses Brian's tracker for COA answers unless HUB_COA_SOURCE=legacy. */
export const labSourceEnabled = () => (process.env.HUB_COA_SOURCE ?? 'lab') !== 'legacy';

export { LABEL as LAB_LABEL, isSacredCups };
