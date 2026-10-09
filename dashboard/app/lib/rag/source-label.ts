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
