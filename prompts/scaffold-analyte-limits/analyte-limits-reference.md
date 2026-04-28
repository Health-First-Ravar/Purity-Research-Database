# Analyte limits reference — Purity Coffee Lab Data

Last verified against May 2025 sources. Numbers cited come from the named
regulation or standard. Purity-specific internal thresholds are NOT included
because they are not publicly disclosed; entries note "Not publicly
disclosed" where applicable. Verify before publishing customer-facing
material.

Legend:
  **EU 2023/915** = Commission Regulation (EU) 2023/915 of 25 April 2023 on
  maximum levels for certain contaminants in food, replacing 1881/2006.
  Applied from 25 May 2023.

  **EU 2017/2158** = Commission Regulation (EU) 2017/2158 establishing
  mitigation measures and benchmark levels for acrylamide. (Benchmarks are
  for monitoring; not legal maxima.)

  **FDA action level** = non-binding guidance the FDA uses for enforcement
  prioritization, not a legal limit.

  **Codex CXS 193-1995** = Codex General Standard for Contaminants and
  Toxins in Food and Feed (most recent amendments through 2023).

  **ANVISA RDC 7/2011** = Brazilian National Health Surveillance Agency
  resolution on contaminant limits in food (most relevant to Brazilian-
  origin coffee).

  **CA Prop 65 NSRL** = California Office of Environmental Health Hazard
  Assessment "No Significant Risk Level" — daily intake at which the
  chemical is considered to pose no significant cancer risk.

---

## Mycotoxins

### Ochratoxin A (OTA) · `ota_ppb` · µg/kg (ppb)

| Source | Limit | Notes |
|---|---|---|
| EU 2023/915 | **3.0 µg/kg** roasted coffee beans + ground roasted coffee | Coffee called out specifically |
| EU 2023/915 | **5.0 µg/kg** soluble (instant) coffee | |
| EU 2023/915 | **5.0 µg/kg** green/raw coffee beans | |
| Codex CXS 193-1995 | 5 µg/kg green coffee | |
| ANVISA RDC 7/2011 (Brazil) | 10 µg/kg roasted/ground; 5 µg/kg green | Origin-side relevance |
| FDA | No coffee-specific limit | |
| WHO/JECFA PTWI | 100 ng/kg body weight per week | Health-based intake reference |

**Industry benchmark (specialty coffee, health-first segment):** brands often
target ≤2.0 µg/kg for roasted as a competitive marker; not codified anywhere.

**Purity stance:** Tests every lot via accredited third-party labs. Specific
internal pass/fail threshold not publicly disclosed.

**Why we test:** OTA is produced by *Aspergillus* and *Penicillium* during
green-stage drying and storage. Roasting reduces ~70-80% but does not
eliminate. Green-stage prevention (Aw < 0.65, proper drying, intact bag
seals) is the real story.

---

### Aflatoxin (total B1+B2+G1+G2) · `aflatoxin_ppb` · µg/kg (ppb)

| Source | Limit | Notes |
|---|---|---|
| EU 2023/915 | **2.0 µg/kg B1**, **4.0 µg/kg total** for most foods | Coffee falls under general food category |
| FDA action level | 20 µg/kg total in human food | |
| Codex CXS 193-1995 | 15 µg/kg total in many foods | |

**Industry benchmark:** Aflatoxins are not commonly an issue in coffee
(higher risk in peanuts, corn, dried fruit, tree nuts). Most specialty
testing is precautionary; results typically <LOQ (limit of quantification).

**Purity stance:** Tested as part of mycotoxin panel. Threshold not publicly
disclosed.

**Why we test:** Same fungal pathway as OTA but distinct toxin family.
Aflatoxin B1 is IARC Group 1 (known human carcinogen); high-dose acute
exposure is hepatotoxic. Coffee risk is low but worth monitoring.

---

## Process contaminants

### Acrylamide · `acrylamide_ppb` · µg/kg (ppb)

| Source | Level | Notes |
|---|---|---|
| EU 2017/2158 | **400 µg/kg roasted coffee** (benchmark, not legal max) | Triggers mitigation review if exceeded |
| EU 2017/2158 | **850 µg/kg** soluble (instant) | |
| EU 2017/2158 | 500 µg/kg coffee substitutes (cereal-based) | |
| EU 2017/2158 | 4000 µg/kg coffee substitutes (chicory) | |
| FDA | No formal limit; "Action Plan for Acrylamide" 2016 monitoring | |
| IARC | Group 2A (probably carcinogenic to humans) | Animal data |
| CA Prop 65 NSRL | 0.2 µg/day | OEHHA 2019 ruling found chemicals in coffee posed no significant risk under Prop 65; coffee exempted from warning labels |

**Industry benchmark:** Health-focused brands publicly target the 200-300
µg/kg range for roasted coffee.

**Purity stance:** Tested per lot. Threshold not publicly disclosed.

**Why we test:** Acrylamide forms via the Maillard reaction during roasting;
peaks around medium roast (~220-230°C bean temp), declines at darker
degrees. Roast curve management is the lever.

---

## Heavy metals (typical raw_values keys: `lead_mg_kg`, `cadmium_mg_kg`, `arsenic_mg_kg`, `mercury_mg_kg`)

Coffee is **not specifically called out** in EU 2023/915 for most heavy
metals — limits below come from the general food category or related
matrices.

### Lead (Pb) · `lead_mg_kg` · mg/kg (ppm)

| Source | Limit | Notes |
|---|---|---|
| EU 2023/915 | 0.10 mg/kg cereals, 0.30 mg/kg vegetables | No coffee-specific entry; "general food" inheritance varies by interpretation |
| FDA Interim Reference Level | 12.5 µg/day adults; 2.2 µg/day children | Total daily exposure, not coffee-specific |
| CA Prop 65 NSRL | 0.5 µg/day | Drove warning-label litigation across food categories |
| WHO TWI | Withdrawn 2010 (no safe level identified) | |

**Industry benchmark:** Specialty brands typically report lead <0.05 mg/kg
in roasted coffee.

**Purity stance:** Tested as part of heavy metals panel. Threshold not
publicly disclosed.

---

### Cadmium (Cd) · `cadmium_mg_kg` · mg/kg

| Source | Limit | Notes |
|---|---|---|
| EU 2023/915 | 0.050-0.20 mg/kg depending on food category | No coffee-specific entry |
| Codex CXS 193-1995 | 0.05 mg/kg cereals; varies by matrix | |
| FDA | No coffee-specific limit | |

**Industry benchmark:** Reported values typically <0.02 mg/kg roasted.

**Purity stance:** Threshold not publicly disclosed.

---

### Arsenic (As, total) · `arsenic_mg_kg` · mg/kg

| Source | Limit | Notes |
|---|---|---|
| EU 2023/915 | Inorganic arsenic limits set for rice, juice, infant food | No coffee-specific entry |
| WHO drinking water | 10 µg/L | Reference, not food matrix |

**Industry benchmark:** Reported values typically <0.05 mg/kg roasted.

**Purity stance:** Threshold not publicly disclosed.

---

### Mercury (Hg, total) · `mercury_mg_kg` · mg/kg

| Source | Limit | Notes |
|---|---|---|
| EU 2023/915 | Limits set for fish, salt, food supplements | No coffee-specific entry |

**Industry benchmark:** Reported values typically <0.01 mg/kg roasted.

**Purity stance:** Threshold not publicly disclosed.

---

## Pesticides

### Glyphosate · `glyphosate_mg_kg` · mg/kg

| Source | MRL | Notes |
|---|---|---|
| EU MRL (Reg 396/2005 + amendments) | **0.10 mg/kg coffee beans** | |
| US EPA tolerance | 1.0 mg/kg coffee beans | |
| Codex MRL | 1.0 mg/kg coffee beans | |
| USDA Organic (NOP §205.602) | Prohibited | Synthetic herbicide |

**Industry benchmark:** USDA Organic lots target <LOQ (typically <0.01
mg/kg).

**Purity stance:** USDA Certified Organic — synthetic glyphosate prohibited
by certification. Tested to confirm.

---

### Other pesticides (multi-residue panel)

EU MRL database (`ec.europa.eu/food/plant/pesticides/eu-pesticides-database`)
sets coffee-specific MRLs for ~500 active substances. **Default MRL when no
specific value is set: 0.01 mg/kg.**

Commonly tested in coffee panels:
- Chlorpyrifos: EU MRL 0.05 mg/kg coffee
- Carbendazim: EU MRL 0.10 mg/kg coffee
- Endosulfan (banned EU/US, still relevant in some origins): EU MRL 0.10 mg/kg
- Atrazine: EU MRL 0.10 mg/kg

**USDA Organic:** All synthetic pesticides prohibited per NOP §205.602.
Approved natural substances list at NOP §205.601.

**Purity stance:** USDA Certified Organic. Multi-residue pesticide panel run
on every lot.

---

## Emerging contaminants

### PFAS (per- and polyfluoroalkyl substances) · `pfas_total_ng_kg` · ng/kg

| Source | Limit | Notes |
|---|---|---|
| EU 2023/915 | Sum of 4 PFAS limits set for fish, meat, eggs | No coffee-specific entry |
| US EPA (April 2024) | 4 ng/L PFOA, 4 ng/L PFOS in **drinking water** | Not food matrix |
| EFSA TWI (2020) | 4.4 ng/kg body weight per week, sum of 4 PFAS | Health-based |

**Industry benchmark:** Forward-looking; most coffee testing is precautionary
and brand-driven, not regulation-driven.

**Purity stance:** Tested for PFAS as part of broader contaminant panel.
Threshold not publicly disclosed.

---

## Quality control parameters

### Moisture content · `moisture_pct` · %

| Source | Specification | Notes |
|---|---|---|
| ICO Resolution 420 (2002) | **Max 12.5%** green coffee for export | International Coffee Organization |
| ISO 6673 | Standard test method (oven drying) | |
| Roasted coffee target | Typically <5% post-roast | |

**Why this matters:** Above 12.5% moisture, mold and mycotoxin risk rises
sharply. Below ~9%, beans become brittle and lose cup quality. The 10-12%
window is the green-coffee target.

---

### Water activity (Aw) · `water_activity` · unitless 0-1

| Threshold | Meaning |
|---|---|
| **Aw < 0.65** | Green coffee target — primary mold/mycotoxin prevention threshold |
| Aw < 0.70 | Minimum to prevent most mold growth (Aspergillus, Penicillium) |
| Aw < 0.60 | Very low microbial risk |
| Aw > 0.80 | Active microbial growth; lot is compromised |

**Source:** Food safety best practice (no single regulatory standard);
consistent with FSMA Preventive Controls and FDA Bad Bug Book guidance on
water activity as a microbial control point.

**Why this matters:** Aw measures the "available" water (water not bound to
solute) and is a better predictor of microbial growth than total moisture.
Jeremy's PCQI training treats green Aw < 0.65 as the primary control point
for OTA prevention.

---

### Caffeine content · `caffeine_pct` · %

| Source | Specification | Notes |
|---|---|---|
| US 21 CFR 165.115 | **≤0.10% caffeine on dry matter** = decaffeinated coffee | Federal standard for "decaf" labeling |
| ICO definition | <0.1% Arabica, <0.3% Robusta = decaf | |
| EU Regulation 1334/2008 | No max for natural caffeine in coffee | |
| Typical regular Arabica | 1.0-1.5% | |
| Typical regular Robusta | 2.0-2.7% | |
| Typical Swiss Water decaf | <0.1% (often ~0.02%) | |

**Why this matters:** Decaf labeling is regulated. Day-to-day caffeine
content varies by varietal and processing.

---

## Bioactives (not contaminants — typical-range references)

### Chlorogenic acids (CGAs) · `cga_mg_g` · mg/g

No regulatory limit. Typical roast-level ranges (mg/g dry basis):

| Roast level | Typical CGA range |
|---|---|
| Green Arabica | 60-100 mg/g |
| Green Robusta | 90-120 mg/g |
| Light roast | 40-65 mg/g |
| Medium roast | 20-40 mg/g |
| Dark roast | 10-25 mg/g |

**Why we measure:** CGAs are the headline antioxidant marker in health-first
coffee. Higher = more antioxidant capacity in cup, but bioavailability is
not 1:1 with cup content. Light-roast preservation drives the PROTECT
profile.

---

### Melanoidins · `melanoidins_mg_g` · mg/g

No regulatory limit. Typical roast-level ranges (mg/g dry basis, approximate):

| Roast level | Typical melanoidins range |
|---|---|
| Light roast | 5-10 mg/g |
| Medium roast | 15-30 mg/g |
| Dark roast | 30-50+ mg/g |

**Why we measure:** Melanoidins are high-MW Maillard polymers that develop
during roasting. They peak in dark roasts and have prebiotic + gut
antioxidant activity — the under-told health story for darker blends like
EASE.

---

### Trigonelline · `trigonelline_mg_g` · mg/g

No regulatory limit. Typical roast-level ranges (mg/g dry basis):

| Roast level | Typical trigonelline range |
|---|---|
| Green | 10-15 mg/g |
| Light roast | 7-10 mg/g |
| Medium roast | 5-7 mg/g |
| Dark roast | 2-5 mg/g |

**Why we measure:** Trigonelline degrades during roasting into NMP
(N-methylpyridinium) and niacin. Intact trigonelline has neuroprotective
associations in animal models; NMP is associated with reduced gastric acid
stimulation (the EASE story).

---

## Format for any analyte not listed above

If a `raw_values` key shows up in COAs that isn't covered here, the
`AnalyteLimitsPanel` component will display:

> No specific guideline mapped for this analyte. See `analyte-limits-reference.md`
> for the broader regulatory landscape. To add a guideline mapping, extend
> `lib/analytes/limits.ts`.

Add new entries as new contaminants are tested. The data module is the
single source of truth — this markdown is generated from it for
human-readable distribution.

---

## Sources for verification

- EU 2023/915: <https://eur-lex.europa.eu/eli/reg/2023/915/oj>
- EU 2017/2158 (acrylamide): <https://eur-lex.europa.eu/eli/reg/2017/2158/oj>
- EU pesticide MRL database: <https://ec.europa.eu/food/plant/pesticides/eu-pesticides-database>
- FDA action levels: <https://www.fda.gov/regulatory-information>
- Codex CXS 193-1995: <https://www.fao.org/fao-who-codexalimentarius/sh-proxy/en/?lnk=1&url=https%253A%252F%252Fworkspace.fao.org%252Fsites%252Fcodex%252FStandards%252FCXS%2B193-1995%252FCXS_193e.pdf>
- USDA Organic NOP: <https://www.ecfr.gov/current/title-7/subtitle-B/chapter-I/subchapter-M/part-205>
- US EPA PFAS rule (April 2024): <https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas>
- OEHHA Prop 65 coffee ruling (2019): <https://oehha.ca.gov/proposition-65/regulation/coffee>
- ICO Resolution 420 (green coffee moisture): <https://www.ico.org/documents/cy2017-18/Documents/422r1e-iso-iqgc.pdf>
- ICC AOAC water activity: AOAC Official Method 978.18

Numbers above were accurate as of the May 2025 reference date. Spot-check
before customer-facing publication; EU regs in particular update annually.
