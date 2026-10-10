// DOI checks for the research library. Parsed PDFs produce DOIs like
// "10.1002/cam4.71612WILEYlogo" (a publisher logo glued on) and placeholders
// like "Article ID unavailable" (also stored as drive_url
// "https://doi.org/Article ID unavailable"); linking them sends people to a
// DOI resolver error. A DOI is shown as a link only when it is well formed.

const DOI_RE = /^10\.\d{4,9}\/\S+$/;
// Text glued onto a DOI by PDF extraction: publisher logos, never part of a DOI.
const ARTIFACT_RE = /(?:WILEY|Elsevier|Springer|logo)$/;

/**
 * Undo PDF-extraction damage that DOIs never contain: control and zero-width
 * characters ("10.1136/bmj.l1580\b", "10.1021/jf073051p\u200b"), en dashes
 * set for hyphens ("10.1007/s00374–006–0152-z"), and text glued on after an em
 * dash ("10.1152/japplphysiol.00570.2014.—combining").
 */
function cleanDoi(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2060\ufeff]/g, '')
    .split('\u2014')[0]
    .replace(/\u2013/g, '-')
    .replace(/[.,;:]+$/, '');
}

/** The DOI if it is well formed (`^10\.\d{4,9}/\S+$`, no extraction artifact), else null. Accepts a doi.org URL. */
export function validDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = cleanDoi(raw.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, ''));
  if (!DOI_RE.test(d) || ARTIFACT_RE.test(d)) return null;
  return d;
}

export const doiUrl = (doi: string) => `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`;

/** True for a doi.org link (whose DOI must then pass validDoi before it is used). */
export const isDoiLink = (url: string | null | undefined) => !!url && /^https?:\/\/(?:dx\.)?doi\.org\//i.test(url.trim());

/** Publication year if plausible (1800 to next year), else null: parsed PDFs give years like 2082. */
export function plausibleYear(y: number | null | undefined): number | null {
  if (y == null) return null;
  const max = new Date().getUTCFullYear() + 1;
  return y >= 1800 && y <= max ? y : null;
}
