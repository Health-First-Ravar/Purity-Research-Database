// How an Ask answer was routed, shown beside the answer as "answered as ...".
// Shared by /api/chat and scripts/eval-ask.ts so the eval tests what ships.

import type { Classification } from './classify';
import type { LabLink, LabSignals } from './lab-lookup';

export type AskRoute = 'COA' | 'Research' | 'Customer answer';

/**
 * COA when lab evidence was used. Research for questions about research,
 * studies or evidence (that name no product, lot, report or lab result) and
 * for health or blend questions. A COA classification with no lab evidence
 * stays COA unless the question is about research. Everything else is a
 * customer answer.
 */
export function askRoute(
  signals: Pick<LabSignals, 'research'>,
  cls: Pick<Classification, 'category'>,
  hasLabEvidence: boolean,
): AskRoute {
  if (hasLabEvidence) return 'COA';
  if (signals.research || cls.category === 'health' || cls.category === 'blend') return 'Research';
  if (cls.category === 'coa') return 'COA';
  return 'Customer answer';
}

/**
 * Lab links shown beside an answer: only when the answer has a lab panel, and
 * only the links of the evidence block that produced the panel (that product's
 * quick view and certificates, or the window's or status view's). Research
 * answers and any other lab blocks contribute none.
 */
export function labLinksFor(chunks: { panel?: unknown; links?: LabLink[] }[]): LabLink[] {
  const withPanel = chunks.find((c) => c.panel);
  if (!withPanel) return [];
  const seen = new Set<string>();
  return (withPanel.links ?? []).filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true))).slice(0, 8);
}
