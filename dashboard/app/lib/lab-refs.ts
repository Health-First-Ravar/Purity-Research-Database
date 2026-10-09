// Lab record references that are fine to show and print, versus internal notes.
// Internal notes in lab record fields: Brian's tracker keeps working
// references next to report numbers, e.g. report "Purity results - August -
// 2025.docx" or a description ending 'also in thread 19769dbb0f49c2a6 "..."'.
// They are not part of a substantiation packet.
const INTERNAL_REF = /\.(?:docx?|xlsx?|pdf|eml|msg)\b|\bthread\s+[0-9a-f]{10,}\b|re-sent\b/i;

/** True for a reference that is an internal file name or e-mail thread, not a lab report number. */
export const isInternalRef = (v: string | null | undefined) => !!v && INTERNAL_REF.test(v);

/** A record description without e-mail thread references ("; also in thread <id> "<subject>""). */
export function publicDescription(v: string | null | undefined): string {
  if (!v) return '';
  return v.replace(/[;,]?\s*(?:also\s+)?in thread\s+[0-9a-f]{10,}(?:\s+"[^"]*")?/gi, '').trim();
}
