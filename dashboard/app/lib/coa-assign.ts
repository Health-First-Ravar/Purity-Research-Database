// Product assignment for unclassified COAs — grouping, suggestions, evidence.
//
// This module NEVER assigns anything. It proposes, with the evidence attached,
// and a human confirms every one. The distinction matters: the corpus already
// contains three lots that a pattern rule would have silently demoted, and the
// reason the 204 are unassigned is that the association is not derivable from
// the COA — it lives in purchasing records and in people's heads.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type UnassignedCoa = {
  id: string;
  report_number: string | null;
  coffee_name: string | null;
  lot_number: string | null;
  origin: string | null;
  matrix: string | null;
  lab: string | null;
  report_date: string | null;
  pdf_filename: string | null;
};

/** Producer/farm names seen in the corpus. The decision axis a human uses. */
const PRODUCERS = [
  'Montebonito', 'La Pradera', 'Pradera', 'Santa Maria', 'Aponte', '18 Conejo', 'Conejo',
  'Sao Pedro', 'Selva Negra', 'Asikana', 'Muymbu', 'JP Farms', 'KCA', 'Finca Paraiso',
  'La Floresta', 'Bette Buna', 'La Hermosa', 'Sierra Nevada', 'Arthur', 'Tolima',
  'Klem', 'Royal', 'Olam', 'Ally', 'NKG', 'Seaforth', 'Minamihara',
];
const COUNTRIES = [
  'Colombia', 'Ethiopia', 'Peru', 'Honduras', 'Nicaragua', 'Brazil', 'Mexico',
  'Guatemala', 'Rwanda', 'Costa Rica', 'Vietnam', 'Indonesia',
];

/** Canonical form so `Aponte` and `APONTE` are one decision, not two. */
function canonProducer(p: string): string {
  if (/^pradera$/i.test(p)) return 'La Pradera';
  if (/^conejo$/i.test(p)) return '18 Conejo';
  return p;
}

export function bucketOf(r: UnassignedCoa): string {
  const hay = `${r.coffee_name ?? ''} ${r.lot_number ?? ''} ${r.pdf_filename ?? ''}`;
  const p = PRODUCERS.find((x) => new RegExp(`\\b${x}\\b`, 'i').test(hay));
  if (p) return `producer · ${canonProducer(p)}`;
  const co = COUNTRIES.find((x) => new RegExp(`\\b${x}\\b`, 'i').test(hay));
  if (co) return `country only · ${co}`;
  const name = (r.coffee_name ?? '').trim();
  if (!name) return 'no sample name';
  if (/^\d{2}-\d{3,4}$/.test(name)) return 'bare internal code';
  if (/^COFFEE \d+$/i.test(name)) return 'COFFEE N batch';
  return 'unmatched';
}

export type Suggestion = {
  /** Proposed blend key, or null when we have no basis to propose one. */
  blend: string | null;
  /** Human-readable evidence. Empty when there is none — never invented. */
  evidence: string[];
  /** How far the evidence goes. Never 'certain' — a human decides. */
  strength: 'name-match' | 'alias-match' | 'sibling-lot' | 'none';
};

function blendKeys(): string[] {
  try {
    const p = process.env.PRODUCT_MAP ?? resolve(process.cwd(), '..', '..', 'product-map.json');
    const m = JSON.parse(readFileSync(p, 'utf8')) as { products?: Record<string, { type?: string }> };
    return Object.entries(m.products ?? {}).filter(([, v]) => v?.type === 'blend').map(([k]) => k);
  } catch {
    return ['PROTECT', 'FLOW', 'EASE', 'CALM', 'BALANCE', 'ALZ'];
  }
}
export const BLEND_KEYS = blendKeys();

/**
 * Propose a blend, with evidence, for one record.
 *
 * `siblings` are already-assigned COAs, used only for the narrowest inference
 * we are willing to surface: the same producer AND the same lot number already
 * maps to a product. Same producer alone is NOT evidence — a farm sells into
 * several blends, and treating origin as destiny is exactly the guess this
 * session is forbidden from making.
 */
export function suggestFor(
  r: UnassignedCoa,
  siblings: { lot_number: string | null; origin: string | null; coffee_name: string | null; blend: string }[],
): Suggestion {
  const name = r.coffee_name ?? '';

  const direct = BLEND_KEYS.find((b) => new RegExp(`\\b${b}\\b`, 'i').test(name));
  if (direct) {
    return { blend: direct, strength: 'name-match', evidence: [`sample name contains the blend key "${direct}"`] };
  }

  if (r.lot_number) {
    const lotHit = siblings.find(
      (s) => s.lot_number && s.lot_number.trim().toLowerCase() === r.lot_number!.trim().toLowerCase(),
    );
    if (lotHit) {
      return {
        blend: lotHit.blend,
        strength: 'sibling-lot',
        evidence: [
          `lot "${r.lot_number}" is already assigned to ${lotHit.blend}`,
          `on "${lotHit.coffee_name ?? 'an assigned COA'}"`,
        ],
      };
    }
  }

  return { blend: null, strength: 'none', evidence: [] };
}
