// Canonical analyte limits — keyed by the same strings the Reports page uses.
// Source-cited. Purity-specific thresholds intentionally NOT included
// (Reva skill rule: never fabricate Purity-specific lab values).
//
// To add a new analyte, append to ANALYTE_LIMITS below. The Reports page
// component reads from this single source of truth.

export type AnalyteKind = 'mycotoxin' | 'process_contaminant' | 'heavy_metal' | 'pesticide' | 'emerging' | 'qc' | 'bioactive';

export type LimitSource = {
  body: string;             // 'EU 2023/915' | 'FDA action level' | 'Codex CXS 193-1995' | etc.
  value: string;            // human-readable, e.g. '3.0 µg/kg'
  matrix?: string;          // 'roasted coffee' | 'green coffee' | 'general food' etc.
  notes?: string;
};

export type AnalyteLimit = {
  key: string;              // matches reports page: 'ota_ppb' | 'cga_mg_g' | etc.
  label: string;            // display label
  unit: string;             // 'µg/kg (ppb)' | 'mg/kg' | '%' | 'mg/g' | 'unitless'
  kind: AnalyteKind;
  // Regulatory + industry references, in roughly decreasing relevance for coffee
  references: LimitSource[];
  // For chart reference lines: the most-relevant numeric threshold in the
  // same unit as the data column. null when no single number applies
  // (e.g., bioactives that have a typical range, not a limit).
  chartThreshold: number | null;
  chartThresholdLabel?: string;
  // Typical-range reference for bioactives (no regulatory limit).
  typicalRange?: { roast: string; range: string }[];
  // Health/regulatory context — short.
  whyWeTest: string;
  // Purity-specific stance. Always honest; never fabricated.
  purityStance: string;
};

const NOT_DISCLOSED =
  'Specific internal pass/fail threshold not publicly disclosed. Tested every lot via accredited third-party labs.';

export const ANALYTE_LIMITS: Record<string, AnalyteLimit> = {
  // ---------------------------------------------------------------------------
  // Mycotoxins
  // ---------------------------------------------------------------------------
  ota_ppb: {
    key: 'ota_ppb',
    label: 'Ochratoxin A (OTA)',
    unit: 'µg/kg (ppb)',
    kind: 'mycotoxin',
    references: [
      { body: 'EU 2023/915', value: '3.0 µg/kg', matrix: 'roasted coffee beans + ground roasted coffee' },
      { body: 'EU 2023/915', value: '5.0 µg/kg', matrix: 'soluble (instant) coffee' },
      { body: 'EU 2023/915', value: '5.0 µg/kg', matrix: 'green/raw coffee beans' },
      { body: 'Codex CXS 193-1995', value: '5 µg/kg', matrix: 'green coffee' },
      { body: 'ANVISA RDC 7/2011 (Brazil)', value: '10 µg/kg roasted; 5 µg/kg green', matrix: 'origin-side relevance' },
      { body: 'WHO/JECFA PTWI', value: '100 ng/kg bw/week', matrix: 'health-based intake reference' },
      { body: 'FDA', value: 'No coffee-specific limit' },
    ],
    chartThreshold: 3.0,
    chartThresholdLabel: 'EU 2023/915 limit (roasted)',
    whyWeTest:
      'Aspergillus and Penicillium toxin formed during green-stage drying and storage. Roasting reduces ~70-80% but does not eliminate. Green Aw < 0.65 is the primary control point.',
    purityStance: NOT_DISCLOSED,
  },

  aflatoxin_ppb: {
    key: 'aflatoxin_ppb',
    label: 'Aflatoxin (total B1+B2+G1+G2)',
    unit: 'µg/kg (ppb)',
    kind: 'mycotoxin',
    references: [
      { body: 'EU 2023/915', value: '2.0 µg/kg B1; 4.0 µg/kg total', matrix: 'general food category' },
      { body: 'FDA action level', value: '20 µg/kg total', matrix: 'human food' },
      { body: 'Codex CXS 193-1995', value: '15 µg/kg total', matrix: 'many foods' },
    ],
    chartThreshold: 4.0,
    chartThresholdLabel: 'EU 2023/915 total aflatoxin (general food)',
    whyWeTest:
      'Same fungal pathway as OTA but distinct toxin. Aflatoxin B1 is IARC Group 1. Coffee risk is low compared to peanuts/corn but worth precautionary monitoring.',
    purityStance: NOT_DISCLOSED,
  },

  // ---------------------------------------------------------------------------
  // Process contaminants
  // ---------------------------------------------------------------------------
  acrylamide_ppb: {
    key: 'acrylamide_ppb',
    label: 'Acrylamide',
    unit: 'µg/kg (ppb)',
    kind: 'process_contaminant',
    references: [
      { body: 'EU 2017/2158 (benchmark)', value: '400 µg/kg', matrix: 'roasted coffee', notes: 'Benchmark for monitoring, not a legal max' },
      { body: 'EU 2017/2158 (benchmark)', value: '850 µg/kg', matrix: 'soluble (instant)' },
      { body: 'EU 2017/2158 (benchmark)', value: '500 µg/kg cereal-based; 4000 µg/kg chicory', matrix: 'coffee substitutes' },
      { body: 'IARC', value: 'Group 2A (probable human carcinogen)', notes: 'animal data' },
      { body: 'CA Prop 65 NSRL', value: '0.2 µg/day', notes: 'Coffee specifically exempted from warning labels by OEHHA 2019 ruling' },
      { body: 'FDA', value: 'No formal limit; "Action Plan for Acrylamide" 2016 monitoring' },
    ],
    chartThreshold: 400,
    chartThresholdLabel: 'EU 2017/2158 benchmark (roasted)',
    whyWeTest:
      'Forms via Maillard reaction during roasting; peaks around medium roast (~220-230°C bean temp), declines at darker degrees. Roast curve management is the lever.',
    purityStance: NOT_DISCLOSED,
  },

  // ---------------------------------------------------------------------------
  // Heavy metals — coffee is NOT specifically listed in EU 2023/915 for most
  // ---------------------------------------------------------------------------
  lead_mg_kg: {
    key: 'lead_mg_kg',
    label: 'Lead (Pb)',
    unit: 'mg/kg (ppm)',
    kind: 'heavy_metal',
    references: [
      { body: 'EU 2023/915', value: '0.10 mg/kg cereals; 0.30 mg/kg vegetables', matrix: 'no coffee-specific entry; general food inheritance varies' },
      { body: 'FDA Interim Reference Level', value: '12.5 µg/day adults; 2.2 µg/day children', notes: 'total daily exposure, not coffee-specific' },
      { body: 'CA Prop 65 NSRL', value: '0.5 µg/day', notes: 'drove warning-label litigation across food categories' },
      { body: 'WHO TWI', value: 'Withdrawn 2010 — no safe level identified' },
    ],
    chartThreshold: 0.10,
    chartThresholdLabel: 'EU 2023/915 reference (cereals — applied to coffee category)',
    whyWeTest:
      'Soil and processing-equipment exposure pathway. Specialty brands typically report <0.05 mg/kg in roasted coffee.',
    purityStance: NOT_DISCLOSED,
  },

  cadmium_mg_kg: {
    key: 'cadmium_mg_kg',
    label: 'Cadmium (Cd)',
    unit: 'mg/kg (ppm)',
    kind: 'heavy_metal',
    references: [
      { body: 'EU 2023/915', value: '0.050-0.20 mg/kg', matrix: 'depending on food category; no coffee-specific entry' },
      { body: 'Codex CXS 193-1995', value: '0.05 mg/kg cereals', matrix: 'varies by matrix' },
      { body: 'FDA', value: 'No coffee-specific limit' },
    ],
    chartThreshold: 0.05,
    chartThresholdLabel: 'EU 2023/915 reference (cereals)',
    whyWeTest:
      'Soil-uptake metal; varies by origin. Reported values typically <0.02 mg/kg roasted.',
    purityStance: NOT_DISCLOSED,
  },

  arsenic_mg_kg: {
    key: 'arsenic_mg_kg',
    label: 'Arsenic (As, total)',
    unit: 'mg/kg (ppm)',
    kind: 'heavy_metal',
    references: [
      { body: 'EU 2023/915', value: 'Inorganic As limits set for rice, juice, infant food', matrix: 'no coffee-specific entry' },
      { body: 'WHO drinking water', value: '10 µg/L', notes: 'reference, not food matrix' },
    ],
    chartThreshold: null,
    whyWeTest:
      'Soil and water exposure. No coffee-specific regulatory limit. Reported values typically <0.05 mg/kg roasted.',
    purityStance: NOT_DISCLOSED,
  },

  mercury_mg_kg: {
    key: 'mercury_mg_kg',
    label: 'Mercury (Hg, total)',
    unit: 'mg/kg (ppm)',
    kind: 'heavy_metal',
    references: [
      { body: 'EU 2023/915', value: 'Limits set for fish, salt, food supplements', matrix: 'no coffee-specific entry' },
    ],
    chartThreshold: null,
    whyWeTest:
      'Industrial and atmospheric deposition pathway. No coffee-specific limit. Reported values typically <0.01 mg/kg roasted.',
    purityStance: NOT_DISCLOSED,
  },

  // ---------------------------------------------------------------------------
  // Pesticides
  // ---------------------------------------------------------------------------
  glyphosate_mg_kg: {
    key: 'glyphosate_mg_kg',
    label: 'Glyphosate',
    unit: 'mg/kg (ppm)',
    kind: 'pesticide',
    references: [
      { body: 'EU MRL (Reg 396/2005)', value: '0.10 mg/kg', matrix: 'coffee beans' },
      { body: 'US EPA tolerance', value: '1.0 mg/kg', matrix: 'coffee beans' },
      { body: 'Codex MRL', value: '1.0 mg/kg', matrix: 'coffee beans' },
      { body: 'USDA Organic NOP §205.602', value: 'Prohibited', notes: 'synthetic herbicide' },
    ],
    chartThreshold: 0.10,
    chartThresholdLabel: 'EU MRL (coffee)',
    whyWeTest:
      'Most widely used herbicide globally. USDA Organic certification prohibits synthetic glyphosate; tested to confirm.',
    purityStance: 'USDA Certified Organic — synthetic glyphosate prohibited by certification. Tested to confirm <LOQ.',
  },

  // Generic pesticide entry — used when raw_values has a pesticide that's not
  // mapped individually. UI can fall back to this.
  pesticides_generic: {
    key: 'pesticides_generic',
    label: 'Pesticide (multi-residue panel)',
    unit: 'mg/kg (ppm)',
    kind: 'pesticide',
    references: [
      { body: 'EU MRL (default when no specific value)', value: '0.01 mg/kg' },
      { body: 'EU MRL chlorpyrifos', value: '0.05 mg/kg', matrix: 'coffee' },
      { body: 'EU MRL carbendazim', value: '0.10 mg/kg', matrix: 'coffee' },
      { body: 'EU MRL endosulfan (banned EU/US, still relevant some origins)', value: '0.10 mg/kg', matrix: 'coffee' },
      { body: 'EU MRL atrazine', value: '0.10 mg/kg', matrix: 'coffee' },
      { body: 'USDA Organic NOP §205.602', value: 'All synthetic pesticides prohibited' },
    ],
    chartThreshold: 0.01,
    chartThresholdLabel: 'EU default MRL (when no specific value set)',
    whyWeTest:
      'Multi-residue panel screens for ~500 active substances. USDA Organic certification prohibits synthetic pesticides.',
    purityStance: 'USDA Certified Organic. Multi-residue pesticide panel run on every lot.',
  },

  // ---------------------------------------------------------------------------
  // Emerging contaminants
  // ---------------------------------------------------------------------------
  pfas_total_ng_kg: {
    key: 'pfas_total_ng_kg',
    label: 'PFAS (sum of 4)',
    unit: 'ng/kg',
    kind: 'emerging',
    references: [
      { body: 'EU 2023/915', value: 'Sum-of-4 PFAS limits set for fish, meat, eggs', matrix: 'no coffee-specific entry' },
      { body: 'US EPA (April 2024)', value: '4 ng/L PFOA, 4 ng/L PFOS', matrix: 'drinking water — not food' },
      { body: 'EFSA TWI (2020)', value: '4.4 ng/kg bw/week', matrix: 'sum of 4 PFAS — health-based' },
    ],
    chartThreshold: null,
    whyWeTest:
      'Forward-looking contaminant family; packaging and water contamination pathways. Most testing today is precautionary, not regulation-driven for coffee specifically.',
    purityStance: NOT_DISCLOSED,
  },

  // ---------------------------------------------------------------------------
  // QC parameters
  // ---------------------------------------------------------------------------
  moisture_pct: {
    key: 'moisture_pct',
    label: 'Moisture content',
    unit: '%',
    kind: 'qc',
    references: [
      { body: 'ICO Resolution 420 (2002)', value: 'Max 12.5%', matrix: 'green coffee for export' },
      { body: 'ISO 6673', value: 'Standard test method (oven drying)' },
      { body: 'Roasted coffee target', value: 'Typically <5%', matrix: 'post-roast' },
    ],
    chartThreshold: 12.5,
    chartThresholdLabel: 'ICO 420 max (green)',
    whyWeTest:
      'Above 12.5%, mold and mycotoxin risk rises sharply. Below ~9%, beans become brittle and lose cup quality. The 10-12% window is the green target.',
    purityStance: NOT_DISCLOSED,
  },

  water_activity: {
    key: 'water_activity',
    label: 'Water activity (Aw)',
    unit: 'unitless 0-1',
    kind: 'qc',
    references: [
      { body: 'Food safety best practice', value: 'Aw < 0.65', matrix: 'green coffee target — primary mold/mycotoxin prevention' },
      { body: 'Microbial threshold', value: 'Aw < 0.70', notes: 'minimum to prevent most mold growth' },
      { body: 'Very low risk', value: 'Aw < 0.60' },
      { body: 'Compromised', value: 'Aw > 0.80', notes: 'active microbial growth' },
      { body: 'AOAC Official Method', value: '978.18 (water activity)' },
    ],
    chartThreshold: 0.65,
    chartThresholdLabel: 'Green coffee target (PCQI / FSMA)',
    whyWeTest:
      'Better predictor of microbial growth than total moisture. Jeremy\'s PCQI training treats green Aw < 0.65 as the primary control point for OTA prevention.',
    purityStance: NOT_DISCLOSED,
  },

  caffeine_pct: {
    key: 'caffeine_pct',
    label: 'Caffeine content',
    unit: '%',
    kind: 'qc',
    references: [
      { body: 'US 21 CFR 165.115', value: '≤0.10% caffeine on dry matter', matrix: 'decaffeinated coffee labeling' },
      { body: 'ICO definition', value: '<0.1% Arabica, <0.3% Robusta', matrix: 'decaf' },
      { body: 'EU Regulation 1334/2008', value: 'No max for natural caffeine in coffee' },
      { body: 'Typical regular Arabica', value: '1.0-1.5%' },
      { body: 'Typical regular Robusta', value: '2.0-2.7%' },
      { body: 'Typical Swiss Water decaf (CALM)', value: '<0.1%, often ~0.02%' },
    ],
    chartThreshold: 0.10,
    chartThresholdLabel: 'US decaf threshold (FDA 21 CFR 165.115)',
    whyWeTest:
      'Decaf labeling is regulated. Day-to-day caffeine content varies by varietal, origin, and processing.',
    purityStance: 'CALM blend uses Swiss Water Process decaffeination. Tested per lot to confirm decaf labeling threshold.',
  },

  // ---------------------------------------------------------------------------
  // Bioactives — no regulatory limits, typical-range references
  // ---------------------------------------------------------------------------
  cga_mg_g: {
    key: 'cga_mg_g',
    label: 'Chlorogenic acids (CGAs)',
    unit: 'mg/g',
    kind: 'bioactive',
    references: [
      { body: 'No regulatory limit', value: 'Bioactive compound, not contaminant' },
    ],
    chartThreshold: null,
    typicalRange: [
      { roast: 'Green Arabica', range: '60-100 mg/g' },
      { roast: 'Green Robusta', range: '90-120 mg/g' },
      { roast: 'Light roast', range: '40-65 mg/g' },
      { roast: 'Medium roast', range: '20-40 mg/g' },
      { roast: 'Dark roast', range: '10-25 mg/g' },
    ],
    whyWeTest:
      'Headline antioxidant marker for health-first coffee. Higher = more antioxidant capacity in cup, but bioavailability is not 1:1 with cup content. Light-roast preservation drives the PROTECT profile.',
    purityStance:
      'Tested as a bioactive marker for blend formulation; specific lot values not publicly disclosed.',
  },

  melanoidins_mg_g: {
    key: 'melanoidins_mg_g',
    label: 'Melanoidins',
    unit: 'mg/g',
    kind: 'bioactive',
    references: [
      { body: 'No regulatory limit', value: 'Bioactive compound, not contaminant' },
    ],
    chartThreshold: null,
    typicalRange: [
      { roast: 'Light roast', range: '5-10 mg/g' },
      { roast: 'Medium roast', range: '15-30 mg/g' },
      { roast: 'Dark roast', range: '30-50+ mg/g' },
    ],
    whyWeTest:
      'High-MW Maillard polymers that develop during roasting. Peak in dark roasts. Prebiotic + gut antioxidant activity — the under-told health story for darker blends like EASE.',
    purityStance:
      'Tested as a bioactive marker for darker-roast formulations; specific lot values not publicly disclosed.',
  },

  trigonelline_mg_g: {
    key: 'trigonelline_mg_g',
    label: 'Trigonelline',
    unit: 'mg/g',
    kind: 'bioactive',
    references: [
      { body: 'No regulatory limit', value: 'Bioactive compound, not contaminant' },
    ],
    chartThreshold: null,
    typicalRange: [
      { roast: 'Green', range: '10-15 mg/g' },
      { roast: 'Light roast', range: '7-10 mg/g' },
      { roast: 'Medium roast', range: '5-7 mg/g' },
      { roast: 'Dark roast', range: '2-5 mg/g' },
    ],
    whyWeTest:
      'Degrades during roasting into NMP (N-methylpyridinium) and niacin. Intact trigonelline has neuroprotective associations in animal models; NMP is associated with reduced gastric acid stimulation (the EASE story).',
    purityStance:
      'Tested as a bioactive marker; specific lot values not publicly disclosed.',
  },
};

// Helper: returns the limit entry for a given analyte key, falling back to a
// generic entry for raw_values keys we haven't mapped yet.
export function getAnalyteLimit(key: string): AnalyteLimit | null {
  if (ANALYTE_LIMITS[key]) return ANALYTE_LIMITS[key];

  // Heuristic fallback: if it looks like a pesticide, return the generic
  // pesticide entry. (raw_values often uses snake_case names like
  // 'chlorpyrifos_mg_kg' or 'glyphosate_mg_kg'.)
  if (/_mg_kg$/.test(key) && key !== 'lead_mg_kg' && key !== 'cadmium_mg_kg' && key !== 'arsenic_mg_kg' && key !== 'mercury_mg_kg' && key !== 'glyphosate_mg_kg') {
    return ANALYTE_LIMITS.pesticides_generic;
  }
  return null;
}

// All analytes with their kind grouping — useful for the reference page index.
export function listAnalytesByKind(): Record<AnalyteKind, AnalyteLimit[]> {
  const out: Record<AnalyteKind, AnalyteLimit[]> = {
    mycotoxin: [],
    process_contaminant: [],
    heavy_metal: [],
    pesticide: [],
    emerging: [],
    qc: [],
    bioactive: [],
  };
  for (const a of Object.values(ANALYTE_LIMITS)) {
    out[a.kind].push(a);
  }
  return out;
}
