-- 0002_add_product_scope
--
-- Persisted Purity/competitor classification for COA rows.
--
-- Naming: `product_scope` (text + CHECK) rather than a boolean `is_purity`.
-- A boolean forces "not ours" and "we don't know yet" into the same value,
-- and those must behave differently: unknown has to fail closed for customer
-- service while remaining visible to the audit team, and it has to be
-- distinguishable so it can be worked down over time. Text + CHECK keeps the
-- values self-describing in raw queries; an enum type would be tidier but is
-- harder to extend and this table is read by scripts outside the app.
--
-- Default is 'unclassified' and the column is NOT NULL, so a row inserted by
-- any future code path — including one nobody has written yet — starts
-- invisible to customer service rather than visible. Failing closed is the
-- requirement; a nullable column would let a NULL slip past an
-- `= 'competitor'` style filter.

alter table public.coas
  add column if not exists product_scope text not null default 'unclassified';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coas_product_scope_check'
  ) then
    alter table public.coas
      add constraint coas_product_scope_check
      check (product_scope in ('purity', 'competitor', 'unclassified'));
  end if;
end $$;

-- CS surfaces filter on this, so it must be indexed.
create index if not exists coas_product_scope_idx on public.coas (product_scope);

comment on column public.coas.product_scope is
  'Whether this COA describes a product Purity sells (purity), a third-party '
  'product held for benchmarking (competitor), or is not yet determined '
  '(unclassified). Customer-service surfaces show ONLY product_scope=''purity''. '
  'The audit team sees all values. Backfilled by '
  'scripts/backfill-product-scope.ts; see AUDIT-FIXES-LOG.md session 2 task 1 '
  'for the classification rules and their limits.';
