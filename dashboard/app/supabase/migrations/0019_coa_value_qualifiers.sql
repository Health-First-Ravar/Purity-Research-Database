-- 0019: track per-analyte value qualifiers (LOQ markers like '<' or '>').
--
-- Eurofins reports below-limit results as "<5.0", "<0.500", etc. — meaning
-- "below the limit of detection / quantification, capped at this number." The
-- parser captures this in `value_as_reported` but the TS importer was
-- dropping it. The numeric value alone treats "<2" the same as "2", which
-- materially changes regulatory interpretation (over vs. under a 2 ppb
-- ceiling).
--
-- This column stores a `{ "ota_ppb": "<0.500", ... }` map so the UI can
-- render the original qualifier when displaying a headline analyte.

alter table public.coas
  add column if not exists value_qualifiers jsonb;

comment on column public.coas.value_qualifiers is
  'Per-headline-column LOQ qualifier from the source COA. e.g. {"ota_ppb": "<0.500"} when below detection. Read-side UI should prefer this string when present over the numeric column.';
