-- Atlas, round 3: split the "Health outcomes" megacluster into body systems.
--
-- Replaces the single b:health branch with 11 body-system branches so the
-- 249-paper outcomes cluster spreads across meaningful sub-domains (cardio,
-- metabolic, oncology, neuro, hepatic & digestive, musculoskeletal, etc.).
--
-- Re-wires every cross-link that previously pointed at b:health.

begin;

-- 1) Drop cross-links touching the old b:health node so the FK doesn't trip
--    when we remove the branch row. (RLS allows editor-only writes; we run
--    this from the SQL editor as service-role so it goes through.)
delete from public.kb_atlas_edges
  where source_node_id = 'b:health' or target_node_id = 'b:health';

-- 2) Drop the legacy branch.
delete from public.kb_atlas_branches where id = 'b:health';

-- 3) Insert the 11 body-system branches.
insert into public.kb_atlas_branches (id, label, description, color, display_order) values
  ('b:cardiovascular', 'Cardiovascular',
   'Heart, vasculature, stroke, hypertension, lipids, atrial fibrillation, endothelial function.',
   '#B91C1C', 20),

  ('b:metabolic',      'Metabolic & endocrine',
   'Diabetes, insulin sensitivity, obesity, gout / uric acid, thyroid, cortisol, sex hormones.',
   '#B45309', 21),

  ('b:oncology',       'Oncology',
   'Cancer epidemiology and prevention across pancreatic, liver, breast, prostate, colorectal, lung, and other sites.',
   '#581C87', 22),

  ('b:neurological',   'Neurological',
   'Parkinson''s, Alzheimer''s, cognition, depression, migraine. Cognitive and mood outcomes.',
   '#4338CA', 23),

  ('b:hepatic',        'Hepatic & digestive',
   'Liver disease (NAFLD, cirrhosis, HCC), gut health, IBS, intestinal inflammation.',
   '#166534', 24),

  ('b:musculoskeletal','Musculoskeletal',
   'Bone density, osteoporosis, fracture risk, joints, muscle.',
   '#92400E', 25),

  ('b:reproductive',   'Reproductive health',
   'Pregnancy, miscarriage, fertility, sexual health, prostate, breast.',
   '#BE185D', 26),

  ('b:immune',         'Immune & inflammation',
   'Inflammatory markers (CRP, IL-6), immune cell biology, autoimmunity.',
   '#DC2626', 27),

  ('b:longevity',      'Longevity & mortality',
   'All-cause mortality cohorts, healthy aging, the Nurses'' Health and EPIC traditions.',
   '#1F2937', 28),

  ('b:sensory',        'Sensory & skin',
   'Vision (macular degeneration), hearing, dental, skin, dermatology.',
   '#C2410C', 29),

  ('b:renal',          'Renal & urinary',
   'Kidney function, chronic kidney disease, urinary outcomes.',
   '#0891B2', 30)
on conflict (id) do nothing;

-- 4) Add cross-links from the body systems back into the rest of the atlas.
--    Curated for the strongest two or three connections per node — avoiding
--    spaghetti while keeping the most defensible relationships.

insert into public.kb_atlas_edges (source_node_id, target_node_id, edge_kind, rationale, weight) values
  -- Bioactives → everywhere they plausibly act
  ('b:bioactives',     'b:cardiovascular',  'cross', 'CGAs and melanoidins associated with improved endothelial function and lower CVD risk.',                  0.9),
  ('b:bioactives',     'b:metabolic',       'cross', 'Chlorogenic acids modulate glucose absorption and insulin sensitivity in human trials.',                  0.9),
  ('b:bioactives',     'b:oncology',        'cross', 'Polyphenol antioxidant activity is the proposed mechanism for several cancer-protective associations.',  0.7),
  ('b:bioactives',     'b:neurological',    'cross', 'Trigonelline and CGAs implicated in Parkinson''s neuroprotection and cognitive performance.',             0.9),
  ('b:bioactives',     'b:hepatic',         'cross', 'Coffee bioactives drive the consistent inverse association with liver disease and HCC.',                  0.9),

  -- Mechanism / pharmacology → systems where receptor / CYP biology dominates
  ('b:mechanism',      'b:cardiovascular',  'cross', 'Adenosine antagonism and catecholamine release drive acute cardiovascular response.',                     0.8),
  ('b:mechanism',      'b:neurological',    'cross', 'Caffeine''s neuro-effects are an A1/A2A adenosine receptor story.',                                       0.9),
  ('b:mechanism',      'b:metabolic',       'cross', 'CYP1A2 polymorphisms moderate metabolic outcomes — the mechanism layer of the diabetes story.',          0.8),

  -- Performance & ergogenics → systems it acts through
  ('b:performance',    'b:cardiovascular',  'cross', 'Acute cardio output gains underlie endurance ergogenic effects.',                                         0.8),
  ('b:performance',    'b:musculoskeletal', 'cross', 'Caffeine''s force-production and pain-perception effects on muscle work.',                                0.7),

  -- Mycotoxins → toxicity targets
  ('b:mycotoxin',      'b:hepatic',         'cross', 'Ochratoxin A and aflatoxin B1 are hepatotoxic; aflatoxin is a class-1 hepatocarcinogen.',                 1.0),
  ('b:mycotoxin',      'b:renal',           'cross', 'OTA is a known nephrotoxin — kidney is the primary target organ.',                                         1.0),
  ('b:mycotoxin',      'b:oncology',        'cross', 'Aflatoxin B1 → HCC is one of the best-characterized causal links in oncology.',                            0.9),

  -- Process contaminants → primary risk endpoint
  ('b:contaminant',    'b:oncology',        'cross', 'Acrylamide is IARC 2A; furan is IARC 2B. Cancer is the regulator''s reason for monitoring.',              0.9),

  -- Heavy metals → toxicity targets
  ('b:metals',         'b:renal',           'cross', 'Cadmium and mercury accumulate in renal cortex; chronic exposure tracks with CKD.',                       0.9),
  ('b:metals',         'b:neurological',    'cross', 'Lead exposure linked to cognitive decline; inorganic mercury crosses BBB.',                                0.8),

  -- Longevity is a downstream aggregate of the major chronic-disease branches
  ('b:longevity',      'b:cardiovascular',  'cross', 'CVD mortality is the largest single contributor to all-cause mortality findings.',                        0.9),
  ('b:longevity',      'b:metabolic',       'cross', 'Diabetes/metabolic syndrome is a leading mortality risk modifier in coffee cohorts.',                     0.8),
  ('b:longevity',      'b:oncology',        'cross', 'Cancer-specific mortality contributes to all-cause findings in NIH-AARP, EPIC, etc.',                     0.8),
  ('b:longevity',      'b:neurological',    'cross', 'Cognitive decline and dementia are major late-life mortality drivers.',                                   0.7),

  -- Inter-system that show up clearly in the literature
  ('b:cardiovascular', 'b:metabolic',       'cross', 'Cardiometabolic outcomes are joined — diabetes and CVD risk co-vary in nearly every cohort.',             0.9),
  ('b:hepatic',        'b:metabolic',       'cross', 'NAFLD is a metabolic-syndrome manifestation; one rarely shows up without the other.',                     0.8),
  ('b:immune',         'b:hepatic',         'cross', 'Liver inflammation (CRP, IL-6) is the bridge between gut/hepatic and systemic immune signaling.',         0.7),
  ('b:reproductive',   'b:metabolic',       'cross', 'Hormonal axes (cortisol, estrogen) sit at the intersection of metabolic and reproductive outcomes.',     0.7)
on conflict (source_node_id, target_node_id, edge_kind) do nothing;

commit;
