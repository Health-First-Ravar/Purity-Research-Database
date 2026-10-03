// One verdict per claim check, derived from the auditor's structured output so
// the scale never depends on the model choosing a label.
//
//   Do not use          disease language (cure / prevent / treat)
//   Needs rewording     any other regulatory flag (overstated effect, causal
//                       leap, unspecified compound or dose, ...)
//   Weak evidence       no flags, but the strongest evidence it relies on is
//                       mechanistic, animal or in vitro (tiers 5-7), or none
//   Supported           no flags and human evidence (tiers 1-4), as worded
//   No health claim     nothing health-related was found to check

export type ClaimVerdict = 'do_not_use' | 'reword' | 'weak' | 'supported' | 'no_health_claim';

export const VERDICT_LABEL: Record<ClaimVerdict, string> = {
  do_not_use: 'Do not use',
  reword: 'Needs rewording',
  weak: 'Weak evidence',
  supported: 'Supported as worded',
  no_health_claim: 'No health claim',
};

/** Brian's status chip class that carries each verdict's color. */
export const VERDICT_CHIP: Record<ClaimVerdict, string> = {
  do_not_use: 'st-fail',
  reword: 'st-watch',
  weak: 'st-incon',
  supported: 'st-pass',
  no_health_claim: 'st-info',
};

export const VERDICT_ORDER: ClaimVerdict[] = ['do_not_use', 'reword', 'weak', 'supported', 'no_health_claim'];

const DISEASE_FLAGS = new Set(['cure_word', 'prevent_word', 'treat_word', 'cures_disease']);
const KNOWN_FLAGS = new Set([
  ...DISEASE_FLAGS, 'overstated_effect', 'single_roast_overclaim', 'in_vitro_to_human_jump', 'observational_as_causal',
  'unfalsifiable_clean_claim', 'organic_equals_healthier', 'bioavailability_assumed', 'unspecified_compound', 'unspecified_dose',
]);
// The auditor's compound list is closed, so "no compound found" does not mean
// "no health claim": wording like "supports immunity" names no compound.
const HEALTH_WORDS =
  /\b(health|healthy|support|boost|benefit|immun|brain|cognit|focus|energy|liver|gut|digest|heart|cardio|blood|sugar|glucose|metabol|weight|inflamm|antioxidant|cancer|disease|diabet|alzheimer|memory|mood|sleep|stress|longevity|detox|cleanse|protect|wellness|nutrient)/i;

export function claimVerdict(a: {
  regulatory_flags?: string[] | null;
  evidence_tier?: number | null;
  compounds_detected?: string[] | null;
  draft_text?: string | null;
}): ClaimVerdict {
  const flags = (a.regulatory_flags ?? []).filter((f) => KNOWN_FLAGS.has(f));
  if (flags.some((f) => DISEASE_FLAGS.has(f))) return 'do_not_use';
  if (flags.length) return 'reword';
  const tier = a.evidence_tier ?? null;
  if (tier == null) {
    const healthish = (a.compounds_detected ?? []).length > 0 || HEALTH_WORDS.test(a.draft_text ?? '');
    return healthish ? 'weak' : 'no_health_claim';
  }
  return tier <= 4 ? 'supported' : 'weak';
}

export const isVerdict = (v: unknown): v is ClaimVerdict =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(VERDICT_LABEL, v);
