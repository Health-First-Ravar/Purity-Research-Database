-- 0015_lab_results_overrides
--
-- Brian's tracker applies two things on top of its raw records that change
-- what a result means, and the Hub has to apply them too:
--   * excluded: CERO sets a record aside ("not scored"), with a reason.
--   * overrides: a table in his page code re-labels some records, e.g. 2021
--     blind-panel samples that are really competitor coffees or Purity blends.
-- original_kind keeps the record's kind before any override, for audit.

alter table public.lab_results
  add column if not exists excluded        boolean not null default false,
  add column if not exists excluded_reason text,
  add column if not exists original_kind   text;

comment on column public.lab_results.excluded is
  'Set aside in Brian''s tracker (not scored). Status reads "Not scored (set aside)".';
