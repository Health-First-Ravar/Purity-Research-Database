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

export function claimVerdict(a: {
  regulatory_flags?: string[] | null;
  evidence_tier?: number | null;
  compounds_detected?: string[] | null;
}): ClaimVerdict {
  const flags = a.regulatory_flags ?? [];
  if (flags.some((f) => DISEASE_FLAGS.has(f))) return 'do_not_use';
  if (flags.length) return 'reword';
  const tier = a.evidence_tier ?? null;
  if (tier == null) return (a.compounds_detected ?? []).length ? 'weak' : 'no_health_claim';
  return tier <= 4 ? 'supported' : 'weak';
}

export const isVerdict = (v: unknown): v is ClaimVerdict => typeof v === 'string' && v in VERDICT_LABEL;
