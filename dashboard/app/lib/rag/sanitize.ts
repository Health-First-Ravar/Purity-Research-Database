// Purity / CHC brand writing rule: never use em or en dashes in sentences
// (see knowledge-base/purity-brain/01_brand-positioning-and-voice.md, "Text
// Guidelines"). The generation prompts also instruct this, but the model
// ignores it often enough that instruction alone is not sufficient, so we strip
// deterministically at the point every answer is finalized.
//
// Only the em dash (—, U+2014) and en dash (–, U+2013) are touched. The
// hyphen-minus (-) is left alone, so compound words (health-first, soil-to-cup,
// third-party), bullet lists, and markdown rules/tables are untouched.

export function stripDashes(input: string): string {
  if (!input) return input;
  return (
    input
      // numeric range (9–11.5, 45–54, 3–4) → hyphen; reads fine, not a sentence dash
      .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
      // em/en dash used as sentence punctuation, spaced or flush → comma + space
      .replace(/\s*[–—]\s*/g, ', ')
      // tidy the artifacts the substitution can create
      .replace(/\s+,/g, ',')
      .replace(/,\s*,+/g, ',')
      .replace(/,\s*([.;:!?)\]])/g, '$1')
  );
}

// Customer-facing answers must not state external regulatory thresholds. The
// model gets EU/FDA/EFSA numbers wrong (e.g. "the EU limit for aflatoxin is 5
// ppb", the real figure is not that), which is a compliance risk. The generate
// prompt forbids it, but as with dashes an instruction alone leaks, so this
// backstop drops any SENTENCE that pins a numeric limit on an external
// regulator. Dropping the whole sentence keeps grammar intact (no mid-sentence
// mangling), and Purity's own internal ceilings live in their own sentences, so
// they survive. Only fires when an external body, a limit word, and a numeric
// concentration all co-occur in one sentence, so ordinary prose is untouched.
const REG_BODY = /\b(E\.?U\.?|European Union|EFSA|F\.?D\.?A\.?|Codex)\b/;
const REG_LIMIT_WORD = /\b(limit|level|ceiling|maximum|threshold|action level|regulat\w*)\b/i;
const REG_NUMBER = /\b\d+(?:\.\d+)?\s*(?:ppb|ppm|µg\/kg|ug\/kg|mg\/kg|micrograms?\/kg)\b/i;

export function stripExternalRegLimits(input: string): string {
  if (!input) return input;
  // Split keeping each sentence's trailing whitespace, so line breaks (lists,
  // paragraphs) survive; joining on ' ' used to flatten every answer to one line.
  const parts = input.split(/(?<=[.!?])(\s+)/);
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i];
    const sep = parts[i + 1] ?? '';
    if (REG_BODY.test(sentence) && REG_LIMIT_WORD.test(sentence) && REG_NUMBER.test(sentence)) {
      if (sep.includes('\n')) out += sep;
      continue;
    }
    out += sentence + sep;
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
