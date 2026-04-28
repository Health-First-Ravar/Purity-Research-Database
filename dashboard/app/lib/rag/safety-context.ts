// Regulatory context for safety-related analytes. Injected into the chat
// generation prompt whenever the question (or retrieved evidence) touches on
// contaminants. Purpose: prevent the chat from quoting raw lab numbers without
// context — a value like "OTA 0.4 ppb" is meaningless to a customer until you
// say "vs. EU limit of 5 ppb."
//
// All limits expressed in the same units the `coas` table stores (ppb = µg/kg
// for analytes; % w/w for moisture/caffeine). Sources cited so the LLM can
// reference them by name when relevant.
//
// Never list a limit we're not sure about — the absence of a regulatory line
// is itself information ("no specific FDA limit exists for X in coffee").

import type { Classification } from './classify';
import type { ChunkHit } from './retrieve';

type Limit = { value: number; product: string; source: string };

type AnalyteFrame = {
  canonical: string;       // human label
  aliases: RegExp;         // detect in question / chunk text
  unit: string;            // our DB unit
  limits: Limit[];         // 0..n regulatory benchmarks
  framing: string;         // 1-sentence rule for how to talk about this number
};

const FRAMES: AnalyteFrame[] = [
  {
    canonical: 'Ochratoxin A (OTA)',
    aliases: /ochratoxin|\bota\b/i,
    unit: 'ppb (µg/kg)',
    limits: [
      { value: 5,  product: 'roasted coffee beans / ground roasted coffee', source: 'EU Reg 2023/915' },
      { value: 10, product: 'soluble (instant) coffee',                      source: 'EU Reg 2023/915' },
    ],
    framing:
      'When citing an OTA value, always compare to the EU 5 ppb limit for roasted coffee. ' +
      'Most Purity COAs come in well under this — frame the value as "X ppb, vs. the EU limit of 5 ppb for roasted coffee."',
  },
  {
    canonical: 'Aflatoxins (total B1+B2+G1+G2)',
    aliases: /aflatoxin/i,
    unit: 'ppb (µg/kg)',
    limits: [
      { value: 5,  product: 'roasted coffee, EU total aflatoxin limit', source: 'EU Reg 2023/915' },
      { value: 2,  product: 'roasted coffee, EU aflatoxin B1 limit',    source: 'EU Reg 2023/915' },
      { value: 20, product: 'roasted coffee, FDA action level (general foods)', source: 'FDA CPG Sec. 555.400' },
    ],
    framing:
      'When citing aflatoxin values, compare to the EU 5 ppb total limit. ' +
      'Many Purity COAs report "Not Detected at LOQ" — frame as "below the limit of quantification (LOQ), well under the EU limit of 5 ppb."',
  },
  {
    canonical: 'Acrylamide',
    aliases: /acrylamide/i,
    unit: 'ppb (µg/kg)',
    limits: [
      { value: 400, product: 'roasted coffee, EU benchmark',  source: 'EU Reg 2017/2158' },
      { value: 850, product: 'soluble (instant) coffee, EU benchmark', source: 'EU Reg 2017/2158' },
    ],
    framing:
      'Acrylamide forms naturally during roasting from asparagine + sugars (Maillard pathway). ' +
      'Compare any value to the EU benchmark of 400 ppb for roasted coffee. ' +
      'Note acrylamide can be reduced by roast profile but cannot be eliminated from any roasted coffee.',
  },
  {
    canonical: 'Lead',
    aliases: /\blead\b/i,
    unit: 'ppb (µg/kg)',
    limits: [
      { value: 100, product: 'EU general food / Pb in supplements (300 µg/kg = 300 ppb baseline; coffee not specifically named)', source: 'EU Reg 2023/915' },
    ],
    framing:
      'There is no coffee-specific EU lead limit; the closest benchmark is the EU general food category. ' +
      'Frame Purity values as "X ppb, well below regulatory thresholds for general foods" rather than naming a specific number that may not match the customer\'s expectation.',
  },
  {
    canonical: 'Cadmium',
    aliases: /cadmium/i,
    unit: 'ppb (µg/kg)',
    limits: [
      { value: 50, product: 'EU general food limit baseline (50 ppb = 0.05 mg/kg)', source: 'EU Reg 2023/915 (closest category)' },
    ],
    framing:
      'No coffee-specific cadmium limit exists. Reference the EU general-food baseline (50 ppb / 0.05 mg/kg) and note this benchmark is conservative.',
  },
  {
    canonical: 'Arsenic',
    aliases: /arsenic/i,
    unit: 'ppb (µg/kg)',
    limits: [
      { value: 100, product: 'EU general food category (inorganic As, conservative reference)', source: 'EU Reg 2023/915 (closest category)' },
    ],
    framing:
      'Coffee does not have a dedicated arsenic limit. Reference the conservative EU general-food benchmark and note total arsenic includes both inorganic (the toxicologically relevant form) and organic forms.',
  },
  {
    canonical: 'Mercury',
    aliases: /mercury/i,
    unit: 'ppb (µg/kg)',
    limits: [
      { value: 100, product: 'EU general food category (Hg in non-fish foods)', source: 'EU Reg 2023/915' },
    ],
    framing:
      'Coffee mercury values are typically near zero. Frame any reported value against the EU 100 ppb benchmark for non-fish foods.',
  },
];

const HEALTH_CLAIM_REMINDER = `
Health-claim language is tightly regulated. NEVER say "prevents", "treats", "cures",
"protects against [disease]", "lowers your risk of cancer/diabetes/Alzheimer's", or
"medicinal." Use "may support", "associated with in research", "studies suggest",
"observational evidence indicates." Defer specific clinical questions to a healthcare
provider.`.trim();

const TONE_REMINDER = `
Voice: peer-level, warm, precise. Coffee drinkers are intelligent adults — talk to
them like adults. Acknowledge nuance ("most studies suggest, though some show
mixed results"). Never sound like marketing copy.`.trim();

/**
 * Build the safety-context block to inject into the chat prompt.
 * Returns empty string when the question/chunks don't touch safety analytes.
 */
export function buildSafetyContext(args: {
  question: string;
  classification: Classification;
  chunks: ChunkHit[];
}): string {
  const { question, classification, chunks } = args;

  const corpus = [
    question,
    ...chunks.map((c) => `${c.title} ${c.heading ?? ''} ${c.content}`),
  ].join('\n');

  const matched = FRAMES.filter((f) => f.aliases.test(corpus));

  // If no specific analyte triggers, but classification is health/coa, inject the
  // tone + health-claim reminders so the model still gets brand discipline.
  const isSafetyAdjacent = ['health', 'coa', 'blend'].includes(classification.category);

  if (matched.length === 0) {
    if (!isSafetyAdjacent) return '';
    return [
      '<safety_framing>',
      HEALTH_CLAIM_REMINDER,
      TONE_REMINDER,
      '</safety_framing>',
    ].join('\n');
  }

  const lines: string[] = ['<safety_framing>'];
  lines.push('When the answer cites a lab value for any analyte below, ALWAYS contextualize against the regulatory benchmark. A bare number creates false alarm.');
  lines.push('');
  for (const f of matched) {
    lines.push(`**${f.canonical}** — unit in our data: ${f.unit}`);
    if (f.limits.length === 0) {
      lines.push('  (No specific regulatory limit exists for this analyte in coffee.)');
    } else {
      for (const l of f.limits) {
        lines.push(`  - ${l.value} ${f.unit.split(' ')[0]} — ${l.product} (${l.source})`);
      }
    }
    lines.push(`  → ${f.framing}`);
    lines.push('');
  }
  lines.push(HEALTH_CLAIM_REMINDER);
  lines.push('');
  lines.push(TONE_REMINDER);
  lines.push('</safety_framing>');

  return lines.join('\n');
}
