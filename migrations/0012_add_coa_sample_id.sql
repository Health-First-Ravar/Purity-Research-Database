-- 0012_add_coa_sample_id
--
-- One Eurofins report number can cover several distinct samples.
--
-- Report 3522613-0 covers six distinct samples. Both
-- `Processed/<report_number>.json` and `import-coas`'s dedup treat
-- report_number as unique, so all six collapsed into one row and five COAs
-- are absent from the database entirely — two of them ours.
--
-- The disambiguator is already printed on every Eurofins certificate:
--
--     Sample Name: Nicaragua Selva Negra Eurofins Sample: 11261580
--                                                        ^^^^^^^^
--
-- `sample_id` stores it so (report_number, sample_id) can key a row.
--
-- NULLABLE on purpose. Existing rows have no sample_id, and labs other than
-- Eurofins do not print one. The importer treats a null sample_id as "not yet
-- keyed" and adopts the row on first match rather than inserting a duplicate
-- beside it — see the matching ladder in import-coas.ts.

alter table public.coas
  add column if not exists sample_id text;

-- The importer's primary lookup.
create index if not exists coas_report_sample_idx
  on public.coas (report_number, sample_id);

comment on column public.coas.sample_id is
  'Lab sample identifier within a report — e.g. the number in "Eurofins '
  'Sample: 11261580". One report number can cover several samples, so '
  '(report_number, sample_id) identifies a COA where report_number alone does '
  'not. Null for labs that do not issue one, and for rows imported before '
  'migration 0012.';
