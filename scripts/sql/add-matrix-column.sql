-- Adds a green/roasted classifier to the coas table so the Reports page can
-- split samples cleanly instead of inferring from blend presence.
--
-- Run in the Supabase SQL editor (or via `supabase db push` if you keep
-- migrations there). Safe to re-run.

alter table public.coas
  add column if not exists matrix text
  check (matrix in ('green', 'roasted')) ;

comment on column public.coas.matrix is
  'Sample matrix: ''green'' (unroasted) or ''roasted''. Populated by import-coas.ts from the COA JSON ''matrix'' field, falling back to blend/sample-name heuristics.';

-- Backfill existing rows from the cleanest signals we have:
--   * a blend (PROTECT/FLOW/EASE/CALM) => roasted
--   * sample/coffee name starting with "green" => green
-- Adjust to taste, then set anything still null by hand.
update public.coas
set matrix = 'roasted'
where matrix is null
  and blend is not null;

update public.coas
set matrix = 'green'
where matrix is null
  and (lower(coalesce(coffee_name, '')) like 'green%'
       or lower(coalesce(coffee_name, '')) like '%green coffee%');

create index if not exists coas_matrix_idx on public.coas (matrix);
