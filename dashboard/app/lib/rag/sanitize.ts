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
