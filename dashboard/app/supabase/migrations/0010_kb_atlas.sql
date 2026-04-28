-- Knowledge Atlas — graph of the knowledge base.
--
-- Two new tables:
--   kb_atlas_branches  — the 12 stable top-level branches (mycotoxin, bioactives,
--                        agriculture, soil biology, …). Hardcoded here so the
--                        taxonomy is queryable rather than living in app code.
--   kb_atlas_edges     — cross-branch relationships (curated by editors).
--                        Carries a one-line `rationale` string explaining why
--                        the link exists ("altitude/varietal drives CGA content").
--   kb_atlas_layout    — persisted node positions, the "perpetual style memory"
--                        layer. Drag a node, position is remembered forever.
--
-- Source-of-truth notes:
--   - "Parent" links (core → branch, branch → paper) are NOT stored here. They
--     are derived from sources.chapter / topic_category at read time. Only the
--     cross-links (the things that aren't tree-shaped) and editor-curated
--     positions live in storage.
--   - Branch IDs are stable text keys ('b:mycotoxin' etc.) — keep them stable.

create table if not exists public.kb_atlas_branches (
  id              text primary key,
  label           text not null,
  description     text,
  color           text,                -- CSS color string (e.g. '#9B552B')
  display_order   int  default 0,
  created_at      timestamptz default now()
);

create table if not exists public.kb_atlas_edges (
  id              uuid primary key default gen_random_uuid(),
  source_node_id  text not null,        -- branch id ('b:agriculture') or source uuid
  target_node_id  text not null,
  edge_kind       text not null check (edge_kind in ('cross','computed')),
  rationale       text,                  -- 1-line "why" — surfaces in the UI
  weight          numeric(3,2) default 0.5 check (weight >= 0 and weight <= 1),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  created_by      uuid references auth.users(id) on delete set null,
  unique (source_node_id, target_node_id, edge_kind)
);

create table if not exists public.kb_atlas_layout (
  node_id         text primary key,      -- branch id or source uuid
  x               numeric not null,
  y               numeric not null,
  locked          boolean default false, -- editor pin (overrides physics on reload)
  updated_at      timestamptz default now(),
  updated_by      uuid references auth.users(id) on delete set null
);

create index if not exists kb_atlas_edges_source_idx on public.kb_atlas_edges(source_node_id);
create index if not exists kb_atlas_edges_target_idx on public.kb_atlas_edges(target_node_id);

-- RLS: read is open to authenticated users. Writes are editor-only.
alter table public.kb_atlas_branches enable row level security;
alter table public.kb_atlas_edges enable row level security;
alter table public.kb_atlas_layout enable row level security;

create policy kb_atlas_branches_read on public.kb_atlas_branches
  for select to authenticated using (true);
create policy kb_atlas_edges_read on public.kb_atlas_edges
  for select to authenticated using (true);
create policy kb_atlas_layout_read on public.kb_atlas_layout
  for select to authenticated using (true);

create policy kb_atlas_branches_write_editor on public.kb_atlas_branches
  for all to authenticated using (public.is_editor()) with check (public.is_editor());
create policy kb_atlas_edges_write_editor on public.kb_atlas_edges
  for all to authenticated using (public.is_editor()) with check (public.is_editor());
create policy kb_atlas_layout_write_editor on public.kb_atlas_layout
  for all to authenticated using (public.is_editor()) with check (public.is_editor());

-- ---- Seed branches ------------------------------------------------------

insert into public.kb_atlas_branches (id, label, description, color, display_order) values
  ('b:mycotoxin',    'Mycotoxin science',    'OTA, aflatoxins, fumonisins. Storage, detection, regulatory frameworks.',                          '#9B552B',  1),
  ('b:bioactives',   'Bioactives',           'Chlorogenic acids, melanoidins, trigonelline. The compounds that drive most health-relevant effects.', '#009F8D', 2),
  ('b:contaminant',  'Process contaminants', 'Acrylamide, furan, PAHs. Roast-stage chemistry and mitigation.',                                    '#B04A2E',  3),
  ('b:metals',       'Heavy metals',         'Lead, cadmium, arsenic, mercury. Soil uptake, monitoring, lab methods.',                            '#6B5A3F',  4),
  ('b:roast',        'Roast chemistry',      'Maillard reactions, flavor formation, antioxidant evolution by roast degree.',                       '#C7833A',  5),
  ('b:health',       'Health outcomes',      'T2D, cardiovascular, Parkinson''s, cancer, longevity, mental health. The clinical evidence map.',     '#2E3A3A',  6),
  ('b:brew',         'Brewing & extraction', 'Method, grind, water chemistry, yield. Bridge from chemistry to cup.',                              '#3F6B4A',  7),
  ('b:culture',      'Coffee culture',       'Ritual, history, community, cafés as third places. The human side of the bean.',                    '#F1B434',  8),
  ('b:agriculture',  'Agriculture',          'Cultivation, varietals, terroir, smallholder economics, farm practices.',                            '#007F3F',  9),
  ('b:soil',         'Soil biology',         'Microbiome, mycorrhizal networks, organic matter cycling. The living substrate.',                    '#5A4632', 10),
  ('b:sourcing',     'Sourcing & sustainability', 'Direct trade, certifications, traceability, climate adaptation.',                                '#007DC0', 11),
  ('b:process',      'Processing',           'Washed, natural, honey, anaerobic. Post-harvest chemistry that shapes everything downstream.',       '#8A6D10', 12)
on conflict (id) do nothing;

-- ---- Seed cross-links ---------------------------------------------------
-- 20 high-confidence cross-branch relationships. Editors can add/remove from
-- the /atlas page once the editor UI lands.

insert into public.kb_atlas_edges (source_node_id, target_node_id, edge_kind, rationale, weight) values
  -- Agriculture is upstream of half the chemistry branches
  ('b:agriculture', 'b:bioactives',  'cross', 'Altitude, varietal, shade affect CGA / trigonelline content of green beans.',           0.9),
  ('b:agriculture', 'b:mycotoxin',   'cross', 'Harvest timing, drying, storage practices set the OTA risk window.',                    0.9),
  ('b:agriculture', 'b:soil',        'cross', 'Farm practice and soil biology are joined at the hip; one drives the other.',           1.0),
  ('b:agriculture', 'b:process',     'cross', 'Variety + farm choices feed directly into which post-harvest process makes sense.',     0.8),
  ('b:agriculture', 'b:sourcing',    'cross', 'Direct trade economics shape what farmers can plant and how.',                          0.8),
  -- Soil biology
  ('b:soil',        'b:metals',      'cross', 'Soil microbiome modulates heavy-metal bioavailability to the plant.',                   0.8),
  ('b:soil',        'b:bioactives',  'cross', 'Mycorrhizal symbiosis modulates plant secondary-metabolite (CGA) production.',          0.7),
  -- Process / roast / brewing chemistry chain
  ('b:process',     'b:bioactives',  'cross', 'Honey / anaerobic / washed shift CGA + acid profiles before roasting.',                 0.7),
  ('b:process',     'b:mycotoxin',   'cross', 'Wet-process drying speed determines OTA growth window post-harvest.',                   0.8),
  ('b:roast',       'b:bioactives',  'cross', 'Roast degrades CGAs and creates melanoidins — direct chemical conversion.',             1.0),
  ('b:roast',       'b:contaminant', 'cross', 'Acrylamide forms during roast from asparagine + reducing sugars (Maillard).',           1.0),
  ('b:brew',        'b:bioactives',  'cross', 'Extraction method, grind, water chemistry decide what reaches the cup.',                0.9),
  -- Health outcomes are downstream of every chemistry branch
  ('b:health',      'b:bioactives',  'cross', 'CGAs / melanoidins / trigonelline are the plausible mechanism for most coffee health effects.', 1.0),
  ('b:health',      'b:mycotoxin',   'cross', 'OTA is a known nephrotoxin and possible carcinogen — health is the reason this branch matters.', 1.0),
  ('b:health',      'b:contaminant', 'cross', 'Acrylamide is a probable human carcinogen (IARC 2A).',                                  0.9),
  ('b:health',      'b:metals',      'cross', 'Heavy-metal toxicology — direct dose-response at chronic exposure.',                    0.9),
  -- Culture
  ('b:culture',     'b:brew',        'cross', 'Cultural traditions (espresso, pour-over, third-wave) shape brewing methods.',          0.8),
  ('b:culture',     'b:agriculture', 'cross', 'Specialty-coffee culture drives demand for varietal diversity and direct trade.',       0.7),
  ('b:culture',     'b:sourcing',    'cross', 'Consumer storytelling about origin is the demand side of sourcing economics.',          0.7),
  -- Sourcing
  ('b:sourcing',    'b:mycotoxin',   'cross', 'Origin selection and supply-chain QC are the upstream lever on contaminant risk.',      0.9)
on conflict (source_node_id, target_node_id, edge_kind) do nothing;
