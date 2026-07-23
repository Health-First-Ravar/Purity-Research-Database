// Source-type classifier for the research corpus.
//
// Every file under knowledge-base/research/ is embedded as kind='research_paper',
// but that pool mixes peer-reviewed studies with consumer media, marketing decks,
// certificates, and even a competitor's lab test. Undifferentiated, that is why a
// customer health answer could be "backed" by a HuffPost article or a competitor
// report. This assigns each source a TYPE so retrieval can keep customer answers
// on vetted science while Reva and the Bibliography still see everything, tagged.
//
// The tag is a heuristic over filename + a text sample. It is deliberately a
// BLOCKLIST design: only the clearly-non-science types are withheld from
// customers; everything else (including the ambiguous "other" bucket, which is
// mostly real papers with cryptic filenames) stays visible. Erring toward
// completeness is the intended behavior. Validated against all 787 files in the
// corpus: 33 land in the customer-excluded types, 754 stay visible.

export type SourceType =
  | 'primary_study'
  | 'review'
  | 'report'
  | 'book'
  | 'media'
  | 'marketing'
  | 'certificate'
  | 'competitor'
  | 'other';

// Types a customer-facing health answer must NOT cite. Reva (researcher) and the
// Bibliography are unaffected; they see every type, labeled.
export const CUSTOMER_EXCLUDED_TYPES: ReadonlySet<SourceType> = new Set<SourceType>([
  'competitor',
  'media',
  'marketing',
  'certificate',
]);

export function isCustomerVisibleType(t: SourceType | null | undefined): boolean {
  return !t || !CUSTOMER_EXCLUDED_TYPES.has(t);
}

/**
 * Classify a research source.
 *
 * @param relPath  path relative to knowledge-base/ (e.g. "research/incoming/x.txt")
 * @param filename the bare filename
 * @param sample   first few KB of the extracted text (may be empty)
 */
export function classifySourceType(relPath: string, filename: string, sample = ''): SourceType {
  const fn = filename.toLowerCase();
  const t = sample.toLowerCase().slice(0, 4000);
  const rel = relPath.toLowerCase();

  // 1) Competitor brands (never Purity).
  if (/\b(lifeboost|bulletproof|mud\\?wtr|mudwtr|\bkion\b|java\s?burn|four sigmatic|peet'?s|folgers)\b/.test(fn))
    return 'competitor';

  // 2) Consumer media / web pages.
  if (/(huffpost|consumerlab|sciencedaily|healthline|webmd| -- s\b|huffington|\.com\b|\| .*life)/.test(fn))
    return 'media';

  // 3) Certificates and agency response letters.
  if (/\b(certificate|q ?grader|demeter|gras-notice|accreditation)\b/.test(fn)) return 'certificate';

  // 4) Purity internal / marketing / operational. Kept specific so it does not
  //    eat real papers.
  if (
    /(proposal|athlete[- ]application|specialty coffee expo|brochure|market brief|quarterly_market|market analysis|\bfact[_ ]?sheet\b|datasheet|\bhandout\b|\bposter\b|task[- ]analysis|competenc|job aid|wellness coach|value assessment|health grade evaluation|program handbk|units of measure|citation issues|needs-assessment|talent development|coffee for athletes|purity dark roast-4|survey- preview|trainer competenc)/.test(
      fn,
    )
  )
    return 'marketing';

  // 5) Books / textbooks and their preview chapters.
  if (
    /(coffee guide to better health|elsevier coffee book|preedy|craft-and-science-of-coffee|iftpressbook|ift press|9781788014977|9780124095175|sample-?chapter|preview ?chapter|previewchapter)/.test(
      fn,
    )
  )
    return 'book';

  // 6) Agency / government reports, standards, regulatory.
  if (
    /(dietary guidelines|advisory committee|advisory action|scientific report\b|safety and nutritional assessment|white[_ ]paper|\bfda\b|\busda\b|\befsa\b|national-quality-standards|\bofpa\b|organic foods production act|guidance_|crop report|program[_ ]overview|supply chain|reference-daily-intakes|productos-fertilizantes|total production by all exporting)/.test(
      fn,
    )
  )
    return 'report';

  // 7) Curated chapter papers are primary literature by construction. (The one
  //    known mislabeled file, trigonelline-ch18, is handled at ingest time.)
  if (/(^|\/)by-chapter\//.test(rel)) return 'primary_study';

  // 8) Reviews / meta-analyses (filename or content).
  if (
    /(meta[- ]analys|umbrella (review|meta)|systematic review|literature review|a review of|an? overview|-a-review|updated review|comprehensive review|review of (recent|the))/.test(
      fn + ' ' + t,
    )
  )
    return 'review';

  // 9) Primary-study filename signals: author-year, journal IDs, DOIs.
  if (
    /(\bet[ _]al\b|^[a-z]+[-_ ]?(19|20)\d\d|[-_ ](19|20)\d\d(\b|\.|_|-)|1-s2\.0-|-main\b|s\d{5}[-_]\d{3}|nutrients-\d|fnut-\d|toxins-\d|molecules-\d|ijms-\d|foods-\d|antioxidants-\d|beverages-\d|animals-\d|microorganisms-\d|pathogens-\d|proceedings-\d|applsci-\d|\b10\.\d{4}\b|j\.?[_ ]?nutr|am[_ ]?j[_ ]|epidemiol|_jsfa|molecular[_ ]nutrition)/.test(
      fn,
    )
  )
    return 'primary_study';

  // 10) Primary-study content signals.
  if (
    /(\babstract\b|materials and methods|\bintroduction\b[\s\S]{0,3000}\breferences\b|randomi[sz]ed|participants|doi:?\s*10\.\d{4}|\bp\s*[<=]\s*0\.\d|\bn\s*=\s*\d|this study (aimed|investigated|examined)|we (investigated|examined|assessed)|©.*elsevier|received:.*accepted:)/.test(
      t,
    )
  )
    return 'primary_study';

  return 'other';
}
