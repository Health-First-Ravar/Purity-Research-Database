-- 0004_add_coa_retired
--
-- Reversible soft-retire for `coas` rows.
--
-- `coas` had no way to withdraw a row. The only alternative was DELETE, which
-- is irreversible on regulated data, so duplicate parse artefacts have been
-- accumulating with no safe way to clear them.
--
-- Mirrors the pattern already used on `sources.valid_until`: stamp a timestamp,
-- leave the row intact. Reversing a mistake is `set retired_at = null`, and the
-- row's analyte values are never touched.
--
-- Read surfaces filter on `retired_at is null`. Nothing is destroyed, so a
-- retired row remains available for audit and for reconstructing why it was
-- withdrawn.

alter table public.coas
  add column if not exists retired_at     timestamptz,
  add column if not exists retired_reason text;

-- Partial index: queries ask for live rows, which is the overwhelming majority,
-- so index the exception rather than the whole column.
create index if not exists coas_retired_at_idx
  on public.coas (retired_at) where retired_at is not null;

comment on column public.coas.retired_at is
  'When set, this row is withdrawn from all read surfaces but preserved. Used '
  'for duplicate parse artefacts. Reverse with: update public.coas set '
  'retired_at = null, retired_reason = null where id = ...';

comment on column public.coas.retired_reason is
  'Why the row was retired, and which row supersedes it if applicable.';
