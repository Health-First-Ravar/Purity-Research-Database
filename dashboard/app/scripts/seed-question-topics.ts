// One-shot seed for the question_topics dictionary.
// Run with:  tsx scripts/seed-question-topics.ts
// Idempotent — uses upsert on slug.

// (env loaded via `node --env-file=.env.local`)
import { createClient } from '@supabase/supabase-js';

type Topic = {
  slug: string;
  label: string;
  category: 'compound' | 'contaminant' | 'blend' | 'process' | 'health_outcome' | 'operations';
  description?: string;
};

const TOPICS: Topic[] = [
  // ---------- Compounds ----------
  { slug: 'cga',                  label: 'Chlorogenic acids (CGAs)',     category: 'compound',    description: '3/4/5-CQA + di-CQAs. Antioxidant, anti-inflammatory, glucose modulation, hepatoprotective via Nrf2.' },
  { slug: 'cga-lactones',         label: 'CGA lactones',                 category: 'compound',    description: 'Formed via lactonization during roasting; distinct bioactivity from parent CGAs.' },
  { slug: 'melanoidins',          label: 'Melanoidins',                  category: 'compound',    description: 'High-MW Maillard polymers; peak in dark roast; prebiotic; gut antioxidant.' },
  { slug: 'trigonelline',         label: 'Trigonelline',                 category: 'compound',    description: 'Niacin precursor. Intact form has neuroprotective associations in animal models.' },
  { slug: 'caffeine',             label: 'Caffeine',                     category: 'compound',    description: 'Adenosine receptor antagonism; CYP1A2 metabolism varies 3-4x between individuals.' },
  { slug: 'nmp',                  label: 'NMP (N-methylpyridinium)',     category: 'compound',    description: 'Dark roast compound from trigonelline degradation; reduced gastric acid stimulation.' },
  { slug: 'cafestol-kahweol',     label: 'Diterpenes (cafestol, kahweol)', category: 'compound',  description: 'Removed ~99% by paper filtration; LDL elevation at dose; hepatoprotective at lower doses.' },

  // ---------- Contaminants ----------
  { slug: 'ota-mycotoxin',        label: 'Ochratoxin A (OTA)',           category: 'contaminant', description: 'Aspergillus/Penicillium toxin; driven by high Aw + poor storage.' },
  { slug: 'aflatoxin',            label: 'Aflatoxin',                    category: 'contaminant', description: 'Mycotoxin family; less common in coffee than OTA but still tested.' },
  { slug: 'acrylamide',           label: 'Acrylamide',                   category: 'contaminant', description: 'Maillard byproduct; peaks at medium roast; EFSA "probable human carcinogen".' },
  { slug: 'pesticides',           label: 'Pesticides',                   category: 'contaminant', description: 'Synthetic and approved-organic. Fat-soluble residues transfer differently to brew.' },
  { slug: 'heavy-metals',         label: 'Heavy metals',                 category: 'contaminant', description: 'Lead, cadmium, arsenic; soil + processing equipment exposure.' },
  { slug: 'pfas',                 label: 'PFAS',                         category: 'contaminant', description: 'Per- and polyfluoroalkyl substances; packaging + supply chain concern.' },
  { slug: 'mold',                 label: 'Mold',                         category: 'contaminant', description: 'Visible mold + mold spores; tied to mycotoxin formation.' },

  // ---------- Blends ----------
  { slug: 'protect',              label: 'PROTECT blend',                category: 'blend',       description: 'Antioxidant focus, lighter roast, highest CGA preservation.' },
  { slug: 'flow',                 label: 'FLOW blend',                   category: 'blend',       description: 'Cognitive / energy support, balanced roast.' },
  { slug: 'ease',                 label: 'EASE blend',                   category: 'blend',       description: 'Gentle, low-acid, digestive comfort.' },
  { slug: 'calm',                 label: 'CALM blend (decaf)',           category: 'blend',       description: 'Swiss Water Process decaf; sleep-supportive.' },
  { slug: 'balance',              label: 'BALANCE blend (legacy)',       category: 'blend',       description: 'Legacy / discontinued reference.' },

  // ---------- Process ----------
  { slug: 'light-vs-dark-roast',  label: 'Light vs dark roast',          category: 'process',     description: 'Compound trade-offs. No single roast is universally healthiest.' },
  { slug: 'swiss-water-decaf',    label: 'Swiss Water decaf process',    category: 'process',     description: 'Chemical-free decaffeination using GCE.' },
  { slug: 'anaerobic-fermentation', label: 'Anaerobic fermentation',     category: 'process',     description: 'LAB-dominant fermentation; distinct compound development. Jeremy has Rwanda primary-source experience.' },
  { slug: 'washed-vs-natural',    label: 'Washed vs natural process',    category: 'process',     description: 'Washed = lower mycotoxin risk if drying managed. Natural = elevated risk if drying poor.' },
  { slug: 'packaging-co2-flush',  label: 'Packaging + CO₂/N₂ flush',     category: 'process',     description: 'Slows CGA oxidation post-roast; part of compound management system.' },
  { slug: 'brew-method-filter',   label: 'Brew method (filtered vs unfiltered)', category: 'process', description: 'Paper filtration removes ~99% of diterpenes.' },

  // ---------- Health outcomes ----------
  { slug: 'liver',                label: 'Liver health',                 category: 'health_outcome' },
  { slug: 'brain-cognitive',      label: 'Brain / cognitive function',   category: 'health_outcome' },
  { slug: 'gut-microbiome',       label: 'Gut microbiome',               category: 'health_outcome' },
  { slug: 'metabolic-t2d',        label: 'Metabolic / Type 2 diabetes',  category: 'health_outcome' },
  { slug: 'cardiovascular',       label: 'Cardiovascular',               category: 'health_outcome' },
  { slug: 'longevity',            label: 'Longevity',                    category: 'health_outcome' },
  { slug: 'parkinsons',           label: "Parkinson's",                  category: 'health_outcome' },
  { slug: 'alzheimers',           label: "Alzheimer's",                  category: 'health_outcome' },
  { slug: 'mental-health',        label: 'Mental health',                category: 'health_outcome' },
  { slug: 'performance',          label: 'Athletic performance',         category: 'health_outcome' },
  { slug: 'acid-reflux-digestion', label: 'Acid reflux / digestion',     category: 'health_outcome' },
  { slug: 'sleep',                label: 'Sleep',                        category: 'health_outcome' },

  // ---------- Operations ----------
  { slug: 'shipping',             label: 'Shipping',                     category: 'operations' },
  { slug: 'subscription',         label: 'Subscription',                 category: 'operations' },
  { slug: 'pricing',              label: 'Pricing',                      category: 'operations' },
  { slug: 'returns',              label: 'Returns',                      category: 'operations' },
  { slug: 'allergens',            label: 'Allergens',                    category: 'operations' },
  { slug: 'bulk-orders',          label: 'Bulk orders',                  category: 'operations' },
  { slug: 'certifications',       label: 'Certifications (Organic, B Corp)', category: 'operations' },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE env vars not set');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  for (const t of TOPICS) {
    const { error } = await sb
      .from('question_topics')
      .upsert(t, { onConflict: 'slug' });
    if (error) {
      console.error(`! ${t.slug}: ${error.message}`);
    } else {
      console.log(`✓ ${t.slug}`);
    }
  }
  console.log(`\nSeeded ${TOPICS.length} topics.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
