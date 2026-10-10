// Streaming Ask answers as they are written, without showing anything the
// answer guardrails would catch.
//
// The model returns JSON ({"answer": "...", "confidence_score": ...}).
// JsonAnswerReader pulls the "answer" string out of the partial JSON as it
// streams. SentenceGate releases it one finished sentence (or markdown line) at
// a time, after the same backstops the final answer gets: dashes stripped, and
// the sentence must pass guardrailViolations() and state no external regulatory
// limit. The first sentence that fails stops the stream; the final answer
// (repaired by generate.ts when needed) then replaces the streamed text.

import { guardrailViolations } from './guardrails';
import { hasExternalRegLimit, stripDashes } from './sanitize';

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Decodes the "answer" string value from streamed JSON text, chunk by chunk.
 * When the model writes the answer as prose before a JSON object of the other
 * fields (parseGenerateResult handles that too), the prose is passed through
 * until the line where the JSON starts.
 */
export class JsonAnswerReader {
  private raw = '';
  private i = -1; // index in raw of the next undecoded answer character; -1 until the opening quote is seen
  private done = false;
  private prose: boolean | null = null;

  /** Feed raw model text; returns the answer characters decoded from it (may be ''). */
  push(delta: string): string {
    this.raw += delta;
    if (this.done) return '';
    if (this.prose === null) {
      const first = this.raw.trimStart()[0];
      if (!first) return '';
      this.prose = first !== '{' && first !== '`';
      if (this.prose) this.i = this.raw.length - this.raw.trimStart().length;
    }
    if (this.prose) {
      // Hold back a trailing newline until we know whether the JSON starts after it.
      const stop = this.raw.slice(this.i).search(/\n\s*(?:\{|```)/);
      if (stop >= 0) { this.done = true; const out = this.raw.slice(this.i, this.i + stop); this.i += stop; return out; }
      const safeEnd = this.raw.endsWith('\n') || /\n\s*$/.test(this.raw) ? this.raw.search(/\n\s*$/) : this.raw.length;
      const out = this.raw.slice(this.i, Math.max(this.i, safeEnd));
      this.i = Math.max(this.i, safeEnd);
      return out;
    }
    if (this.i < 0) {
      const m = /"answer"\s*:\s*"/.exec(this.raw);
      if (!m) return '';
      this.i = m.index + m[0].length;
    }
    let out = '';
    const s = this.raw;
    while (this.i < s.length) {
      const ch = s[this.i];
      if (ch === '"') { this.done = true; break; }
      if (ch !== '\\') { out += ch; this.i++; continue; }
      if (this.i + 1 >= s.length) break; // escape split across chunks: wait
      const e = s[this.i + 1];
      if (e === 'u') {
        if (this.i + 6 > s.length) break;
        out += String.fromCharCode(parseInt(s.slice(this.i + 2, this.i + 6), 16));
        this.i += 6;
      } else {
        out += ESCAPES[e] ?? e;
        this.i += 2;
      }
    }
    return out;
  }
}

// Words whose period does not end a sentence.
const ABBREV = /(?:\be\.g|\bi\.e|\bet al|\bvs|\bapprox|\bca|\bDr|\bFig|\bNo|\bSt|\bMr|\bMs|\bMrs|\bU\.S|\bE\.U)\.$/i;

/** Index just past the last sentence or line end in `text`, or 0. */
export function lastBoundary(text: string): number {
  let best = 0;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === '\n') best = k + 1;
    else if ((ch === '.' || ch === '!' || ch === '?') && k + 1 < text.length && /\s/.test(text[k + 1])) {
      if (ch === '.' && ABBREV.test(text.slice(Math.max(0, k - 7), k + 1))) continue;
      if (ch === '.' && /(?:^|\n)\s*\d+\.$/.test(text.slice(Math.max(0, k - 8), k + 1))) continue; // "1. " list marker
      best = k + 1;
    }
  }
  return best;
}

/** Releases finished, guardrail-clean sentences of a growing answer to `emit`. */
export class SentenceGate {
  private text = '';
  private released = 0;
  private stopped = false;

  constructor(private emit: (chunk: string) => void) {}

  /** True once a sentence failed a check; nothing more is released. */
  get blocked() { return this.stopped; }

  push(chars: string) {
    if (!chars) return;
    this.text += chars;
    if (this.stopped) return;
    const rest = this.text.slice(this.released);
    const end = lastBoundary(rest);
    if (!end) return;
    const segment = stripDashes(rest.slice(0, end));
    if (guardrailViolations(segment).length || hasExternalRegLimit(segment)) { this.stopped = true; return; }
    this.released += end;
    this.emit(segment);
  }
}
