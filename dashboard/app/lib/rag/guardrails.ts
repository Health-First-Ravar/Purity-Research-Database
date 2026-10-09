// Answer guardrails for Ask, as checks. scripts/eval-ask.ts runs these on
// generated answers (npm run eval:ask -- --answers); the generate prompt states
// the same rules, and sanitize.ts strips dashes deterministically.
//
// Heuristics, tuned to flag the failures seen in QA (2026-10-09), not a
// compliance review: a pass here does not clear copy for publication.

// Hedges, and positioning language ("positioned around energy and focus"), which states what a blend is for, not an outcome.
const HEDGE = /\b(may|might|could|can help|associated|linked to|research(?: \w+){0,2} (?:suggests?|indicates?|links?)|in (?:research|studies)|studies suggest|evidence (?:suggests|indicates)|tends? to|is thought to|appears? to|in some studies|observational|positioned)\b/i;
const BENEFIT = /\b(benefits?|improv\w*|support\w*|boost\w*|enhanc\w*|protect\w*|reduc\w*|lower\w*|increas\w*|built for|gives? you)\b/i;
const TARGET = /\b(cogniti\w*|focus|energy|insulin|glucose|blood sugar|liver|brain|gut|microbiome|inflammat\w*|metabol\w*|sleep|heart|cardio\w*|beta-cell|memory|mood|longevity|immun\w*)\b/i;
// "CALM gives you the compound benefits": a blend promised a benefit outright.
const BLEND_PROMISE = /\b(PROTECT|FLOW|EASE|CALM|BALANCE)\b[^.]*\b(gives?|delivers?|provides?|offers?)\b[^.]*\bbenefits?\b/;
const unhedgedBenefit = (s: string) => !HEDGE.test(s) && ((BENEFIT.test(s) && TARGET.test(s)) || BLEND_PROMISE.test(s));
const DISEASE_VERB = /\b(cures?|cured|treats?|treated|prevents?|prevented)\b/gi;
const NEGATION = /\b(not|never|no|nor|without|avoid|don't|doesn't|isn't|can't|cannot)\b[^.]{0,30}$/i;

const RULES: { name: string; test: (text: string, sentences: string[]) => boolean }[] = [
  { name: 'double hyphen "--"', test: (t) => /(^|[^-])--(?!-)/m.test(t.replace(/^\s*-{3,}\s*$/gm, '')) },
  { name: 'em or en dash', test: (t) => /[—–]/.test(t) },
  {
    name: 'unhedged cure/treat/prevent',
    test: (t) => [...t.matchAll(DISEASE_VERB)].some((m) => !NEGATION.test(t.slice(Math.max(0, (m.index ?? 0) - 40), m.index))),
  },
  { name: 'tells staff to contact Purity', test: (t) => /\b(reach out to (?:us|purity|our team)|contact (?:us|purity) directly|(?:email|call|message) us)\b/i.test(t) },
  {
    name: 'offers a feature that does not exist',
    test: (t) => /\b(I|we)(?:'ll| will| can| could)\s+(?:flag|notify|alert|ping|email|text|remind|let you know|keep you posted|send you)\b/i.test(t),
  },
  {
    name: 'unverified operational policy',
    test: (_t, ss) => ss.some((s) => /\b(ship(?:s|ped|ping)?|released?|sold|go(?:es)? out|held|quarantin\w*|recall\w*|destroy\w*|discard\w*)\b/i.test(s)
      && /\b(over (?:a|the|our) limit|fail(?:s|ed)?|out of spec|exceed\w*)\b/i.test(s)),
  },
  {
    name: 'superlative',
    test: (t) => /\b(leading|world[-\s]class|world's (?:best|leading|top)|in the world|foremost|premier|renowned|the (?:purest|cleanest|safest|healthiest)|the best (?:\w+ )?(?:coffee|blend|brand|lab|labs|product|choice|quality))\b/i.test(t),
  },
  {
    name: 'unhedged benefit claim',
    test: (_t, ss) => ss.some(unhedgedBenefit),
  },
];

/** Split into sentences and markdown lines (a heading counts as a sentence). */
function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/^[#>*\-\d.\s]+/, '').trim())
    .filter(Boolean);
}

/** Names of the guardrails an answer breaks; [] when it passes. */
export function guardrailViolations(answer: string): string[] {
  const ss = sentences(answer);
  return RULES.filter((r) => r.test(answer, ss)).map((r) => {
    if (r.name === 'unhedged benefit claim') {
      const s = ss.find(unhedgedBenefit);
      return `${r.name}: "${(s ?? '').slice(0, 120)}"`;
    }
    return r.name;
  });
}
