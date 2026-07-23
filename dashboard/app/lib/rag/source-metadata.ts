// Metadata extraction for research sources.
//
// The old ingest set a source's title to "the first line longer than 20 chars",
// which on PDF-to-text output is usually a watermark or journal banner ("This
// article was downloaded by: [Florida Atlantic University]"). That fed the
// Bibliography and every citation. This pulls a real title, DOI, and year.
//
// DOI is the reliable, high-value field: it is the dedup key and lets reference
// managers resolve correct authors/journal/year on export. Title is best-effort
// (arbitrary PDF-to-text is messy); when the extracted title looks like
// boilerplate we fall back to the filename, which for the hand-named incoming
// files is often already descriptive.

export type SourceMetadata = { title: string; doi: string | null; year: string | null };

const fixLigatures = (s: string): string =>
  s
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl')
    .replace(/ı̈/g, 'i')
    .replace(/­/g, ''); // soft hyphen

const DOI_RE = /10\.\d{4,9}\/[^\s"'<>)\]]+/;

const BOILER =
  /^(original (research|paper|article|contribution)|research (article|paper)|review (article|paper)|vol\.?:|volume\s|downloaded (from|by)|this article was downloaded|received:|accepted:|revised:|published|©|copyright|https?:|doi:|www\.|pubs\.|abstract\b|keywords|see discussions|open access|creative commons|contents lists|available online|advance access|annals of|journal of|european food|international journal|elsevier|springer|wiley|nature|frontiers|molecular nutrition|the author|citation:|reviewed by|correspondence|edited by|\*correspond|\d[\d\s.:–-]*$|page \d)/i;

const AUTHORS =
  /(\b(PhD|MD|MSc|DrPH|ScD|BSc|MPH|R&D)\b|·|;.*;|^[A-Z][a-z]+ [A-Z]\.|university of|institute|department of|,\s*\*)/;

function titleFromText(raw: string): string {
  const lines = raw.split('\n').map(fixLigatures).map((l) => l.replace(/\s+/g, ' ').trim());
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const l = lines[i];
    if (!l || l.length < 15 || l.length > 250 || BOILER.test(l) || AUTHORS.test(l)) continue;
    if (!/[a-z]/.test(l)) continue; // skip ALL-CAPS journal banners
    if ((l.match(/\d/g) || []).length > l.length * 0.3) continue; // mostly numbers
    let title = l;
    for (let j = i + 1; j < lines.length && title.length < 160; j++) {
      const n = lines[j];
      if (!n || BOILER.test(n) || AUTHORS.test(n) || /^abstract/i.test(n) || n.length < 6 || !/[a-z]/.test(n))
        break;
      title += ' ' + n;
      if (/[.?]$/.test(n)) break;
    }
    return title.replace(/\s+/g, ' ').trim().slice(0, 220);
  }
  return '';
}

function cleanFilename(fn: string): string {
  return fn
    .replace(/\.txt$/i, '')
    .replace(/ \(\d+\)$/, '')
    .replace(/^_/, '')
    .replace(/^[a-z]+[-_ ]?(19|20)\d\d[-_ ]?/i, '') // strip leading author-year
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const filenameIsCryptic = (fn: string): boolean =>
  /^(nutrients-|fnut-|toxins-|molecules-|ijms-|foods-|antioxidants-|beverages-|s\d{5}|1-s2\.0|10\.\d|[0-9a-f]{12,}|\d{5,}|wasj_|ajol|_13_|obm\.)/i.test(
    fn,
  );

const titleLooksBad = (t: string): boolean =>
  !t || t.length < 25 || /pubs\.|reviewed by|correspondence|advance access|available online|©|r&d,|university of|\.org\//i.test(t);

export function deriveSourceMetadata(raw: string, filename: string): SourceMetadata {
  const fixed = fixLigatures(raw);

  const doiMatch = fixed.match(DOI_RE);
  const doi = doiMatch ? doiMatch[0].replace(/[.,;)]+$/, '') : null;

  let year: string | null = (filename.match(/(19|20)\d\d/) || [])[0] ?? null;
  if (!year) {
    const head = fixed.slice(0, 1500);
    const m = head.match(/\((19|20)\d\d\)/) || head.match(/\b(19|20)\d\d\b/);
    year = m ? m[0].replace(/[()]/g, '') : null;
  }

  const extracted = titleFromText(raw);
  const cleaned = cleanFilename(filename);
  const title = titleLooksBad(extracted)
    ? filenameIsCryptic(filename)
      ? extracted || cleaned
      : cleaned
    : extracted;

  return { title: (title || cleaned).slice(0, 220), doi, year };
}
