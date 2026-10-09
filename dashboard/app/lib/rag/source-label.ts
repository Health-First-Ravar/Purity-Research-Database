// What kind of source an evidence chunk is, for people reading the evidence.
//
// Every file under knowledge-base/research/ is stored as kind 'research_paper',
// including Ildi's book (The Coffee Guide to Better Health) and the Circular
// Health Coffee framework, so the stored kind alone mislabels them. This reads
// the title and sources.metadata.source_type (set by source-classify.ts) first.

const TYPE_WORDS: Record<string, string> = {
  primary_study: 'primary study',
  review: 'review',
  report: 'report',
  book: 'book',
  media: 'media',
  marketing: 'marketing',
  certificate: 'certificate',
  competitor: 'competitor',
};

export function evidenceTypeLabel(c: { kind: string; title?: string | null; source_type?: string | null }): string {
  const title = c.title ?? '';
  if (c.kind === 'coffee_book' || /coffee guide to better health/i.test(title)) return "Ildi's book";
  if (/circular health coffee/i.test(title)) return 'CHC framework';
  if (c.kind === 'purity_brain') return 'Purity brand doc';
  if (c.kind === 'reva_skill') return 'Reva skill';
  if (c.kind === 'research_paper') return (c.source_type && TYPE_WORDS[c.source_type]) || 'research paper';
  return c.kind.replace(/_/g, ' ');
}

/**
 * A readable source title. Ingested files keep their file names as titles
 * ("The Coffee Guide to Better Health_7x10_FINAL-550-Pages-24Dec2025",
 * "Long-term-consumption-of-a-green-roasted-coffee-blend-..."), which Ask showed
 * in its sources line. Named books get their proper title; other file-name
 * titles lose underscores, hyphens between words and print-production tokens.
 */
export type SourceDisplay = { title?: string; authors?: string[]; year?: number | null };

/** "Lin et al., 2021", "Smith and Jones, 2019", "Smith, 2019", "2019" or "". */
function citeSuffix(d: SourceDisplay): string {
  const a = d.authors ?? [];
  const who = a.length > 2 ? `${a[0]} et al.` : a.length === 2 ? `${a[0]} and ${a[1]}` : a[0] ?? '';
  return [who, d.year ?? ''].filter(Boolean).join(', ');
}

export function displaySourceTitle(
  c: { kind: string; title?: string | null },
  /** sources.metadata.display (scripts/source-display-titles.ts): the Crossref title and authors, when known. */
  display?: SourceDisplay | null,
): string {
  const t = (c.title ?? '').trim();
  if (c.kind === 'coffee_book' || /coffee guide to better health/i.test(t)) return 'The Coffee Guide to Better Health (Ildi Revi)';
  if (display?.title) {
    const raw = display.title.replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2').replace(/\s*[–—]\s*/g, ': ');
    const title = raw.length > 150 ? `${raw.slice(0, 147).replace(/\s+\S*$/, '')}…` : raw;
    const cite = citeSuffix(display);
    return cite ? `${title} (${cite})` : title;
  }
  if (/^circular health coffee/i.test(t)) return t.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ');
  const fileLike = /_/.test(t) || (!/\s/.test(t) && /-/.test(t));
  if (!fileLike) return t;
  return t
    .replace(/\.(pdf|txt|docx?)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/(?<=[A-Za-z0-9])-(?=[A-Za-z0-9])/g, ' ')
    .replace(/\b(?:FINAL|DRAFT|v\d+|\d+x\d+|\d+-Pages|\d{1,2}[A-Z][a-z]{2}\d{4})\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
