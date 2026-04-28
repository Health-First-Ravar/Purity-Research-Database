-- 0020: editor-managed limits table.
--
-- Hardcoded constants moved to a queryable, admin-editable table. The /reports/[id]
-- page, the Reports table coloring, and any chat-side use of "is this over the
-- strictest published limit" all read from this table. Only `admin` can write
-- (RLS); everyone reads.
--
-- Seed values come from CHC-Strictest-Analyte-Limits.xlsx (May 2025 verified).

create table if not exists public.coa_limits (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,             -- DB column name ('ota_ppb') or raw_values key ('raw:Citric Acid') or 'heavy_metals.lead'
  label         text not null,
  unit          text not null default '',
  category      text not null check (category in ('mycotoxin','process_contaminant','heavy_metal','pesticide','quality','bioactive')),
  direction     text not null check (direction in ('ceiling','floor','range')),
  value         numeric,                          -- ceiling/floor threshold
  min_value     numeric,                          -- range lower bound
  max_value     numeric,                          -- range upper bound
  source        text not null,
  notes         text,
  display_order int default 0,
  active        boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  updated_by    uuid references auth.users(id) on delete set null
);

create index if not exists coa_limits_key_idx on public.coa_limits(key) where active;
create index if not exists coa_limits_category_idx on public.coa_limits(category);

alter table public.coa_limits enable row level security;

drop policy if exists coa_limits_read on public.coa_limits;
create policy coa_limits_read on public.coa_limits
  for select to authenticated using (true);

drop policy if exists coa_limits_write_admin on public.coa_limits;
create policy coa_limits_write_admin on public.coa_limits
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Seed from the canonical limits set.
insert into public.coa_limits (key, label, unit, category, direction, value, min_value, max_value, source, notes, display_order) values
  ('ota_ppb',                    'Ochratoxin A (OTA)',                    'ppb',  'mycotoxin',           'ceiling', 2,    null, null, 'CHC Health-Grade Green Standard',                  'Stricter than EU 2023/915 (3 ppb roasted, 5 ppb green) and Brazil ANVISA (10 ppb).',                                  10),
  ('aflatoxin_ppb',              'Aflatoxin (total B1+B2+G1+G2)',         'ppb',  'mycotoxin',           'ceiling', 4,    null, null, 'EU 2023/915 (general food)',                       'FDA action level is 20 ppb total.',                                                                                    20),
  ('acrylamide_ppb',             'Acrylamide',                            'ppb',  'process_contaminant', 'ceiling', 400,  null, null, 'EU 2017/2158 benchmark (roasted)',                 'Monitoring benchmark, not a legal max. CA Prop 65 exempted coffee in 2019.',                                          30),
  ('heavy_metals.lead',          'Lead (Pb)',                             'ppb',  'heavy_metal',         'ceiling', 15,   null, null, 'CHC Health-Grade Green Standard',                  '0.015 mg/kg. Stricter than EU 2023/915 cereals reference (100 ppb).',                                                  40),
  ('heavy_metals.cadmium',       'Cadmium (Cd)',                          'ppb',  'heavy_metal',         'ceiling', 15,   null, null, 'CHC Health-Grade Green Standard',                  '0.015 mg/kg. Stricter than EU 2023/915 cereals reference (50 ppb).',                                                   50),
  ('heavy_metals.arsenic',       'Arsenic (As, total)',                   'ppb',  'heavy_metal',         'ceiling', 15,   null, null, 'CHC Health-Grade Green Standard',                  'No coffee-specific EU limit; CHC sets the floor.',                                                                     60),
  ('heavy_metals.mercury',       'Mercury (Hg, total)',                   'ppb',  'heavy_metal',         'ceiling', 1,    null, null, 'CHC Health-Grade Green Standard',                  'No coffee-specific EU limit; CHC sets the floor.',                                                                     70),
  ('moisture_pct',               'Moisture content',                      '%',    'quality',             'range',   null, 9.0,  11.5, 'CHC Health-Grade Green Standard',                  'Tighter than ICO Resolution 420 ceiling of 12.5% green for export.',                                                  80),
  ('water_activity',             'Water activity (Aw)',                   '',     'quality',             'range',   null, 0.50, 0.60, 'CHC Health-Grade Green Standard',                  'Tighter than PCQI/FSMA best-practice ceiling of 0.65 for green coffee.',                                              90),
  ('caffeine_pct',               'Caffeine (regular green)',              '% DWB','bioactive',           'floor',   0.9,  null, null, 'CHC Health-Grade Green Standard',                  'Minimum, not ceiling. Typical Arabica 1.0–1.5%; CHC sets a quality floor. Decaf is a separate ceiling (< 0.10% DWB).', 100),
  ('cga_mg_g',                   'Chlorogenic acids (CGAs)',              'mg/g', 'bioactive',           'floor',   40,   null, null, 'CHC Health-Grade Green Standard',                  'Minimum. Typical green Arabica 60–100 mg/g.',                                                                          110),
  ('raw:Citric Acid',            'Citric acid',                           'mg/g', 'bioactive',           'floor',   2.0,  null, null, 'CHC Health-Grade Green Standard',                  'Minimum, not ceiling. Acidity quality marker.',                                                                        120),
  ('raw:Malic Acid',             'Malic acid',                            'mg/g', 'bioactive',           'floor',   1.5,  null, null, 'CHC Health-Grade Green Standard',                  'Minimum, not ceiling. Acidity quality marker.',                                                                        130),
  ('raw:Quinic Acid',            'Quinic acid',                           'mg/g', 'bioactive',           'floor',   3.0,  null, null, 'CHC Health-Grade Green Standard',                  'Minimum, not ceiling. CGA degradation product; quality marker.',                                                       140)
on conflict (key) do nothing;
