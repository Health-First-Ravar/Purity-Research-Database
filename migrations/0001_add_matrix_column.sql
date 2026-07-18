-- 0001_add_matrix_column
-- Reflects the matrix column that was applied by hand in the Supabase console.
-- Idempotent: safe to (re-)run; recording it captures current schema state as
-- the baseline for the migration framework.

alter table public.coas
  add column if not exists matrix text
  check (matrix in ('green', 'roasted'));

-- Backfill best-effort from existing fields.
update public.coas set matrix = 'roasted'
  where matrix is null and blend is not null;

update public.coas set matrix = 'green'
  where matrix is null and coffee_name ilike 'green%';

create index if not exists coas_matrix_idx on public.coas (matrix);
