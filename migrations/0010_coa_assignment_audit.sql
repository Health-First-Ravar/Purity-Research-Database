-- 0010_coa_assignment_audit
--
-- Attribution and reversibility for product assignment.
--
-- 204 COAs have no product association. Closing that is human work, and the
-- work is only safe if every assignment records who made it, when, and what it
-- replaced — an assignment moves a record into customer-service visibility, so
-- it needs the same audit trail as any other change to regulated data.
--
-- Two parts:
--
--   1. `coas.assigned_by` / `assigned_at` — the current state, and the signal
--      the backfill uses to leave a human decision alone.
--   2. `coa_assignment_log` — append-only history holding the PREVIOUS values,
--      so any assignment can be reverted exactly rather than guessed at.
--
-- Nothing is ever deleted. Reverting writes a new log row and restores the
-- prior values.

alter table public.coas
  add column if not exists assigned_by uuid references public.profiles(id),
  add column if not exists assigned_at timestamptz;

create index if not exists coas_assigned_by_idx
  on public.coas (assigned_by) where assigned_by is not null;

comment on column public.coas.assigned_by is
  'Profile that assigned this COA''s product/scope by hand. When set, '
  'scripts/backfill-product-scope.ts must not overwrite product_scope — a '
  'pattern rule silently reverting a human decision is how three known '
  'over-limit lots nearly dropped off the CS surface (session 5 task 3).';

create table if not exists public.coa_assignment_log (
  id             uuid primary key default gen_random_uuid(),
  coa_id         uuid not null references public.coas(id),
  -- previous values, so a revert restores exactly rather than approximating
  prev_blend         text,
  prev_product_scope text,
  new_blend          text,
  new_product_scope  text,
  action         text not null check (action in ('assign', 'revert', 'skip')),
  note           text,
  actor          uuid not null references public.profiles(id),
  created_at     timestamptz not null default now()
);

create index if not exists coa_assignment_log_coa_idx on public.coa_assignment_log (coa_id, created_at desc);
create index if not exists coa_assignment_log_actor_idx on public.coa_assignment_log (actor, created_at desc);

comment on table public.coa_assignment_log is
  'Append-only record of product/scope assignment decisions, including the '
  'values they replaced. Never updated or deleted; a revert is a new row.';

alter table public.coa_assignment_log enable row level security;

-- Editors and admins only. There is no read path for customer service: this is
-- back-office provenance, not product information.
drop policy if exists coa_assignment_log_editor on public.coa_assignment_log;
create policy coa_assignment_log_editor on public.coa_assignment_log
  for all
  using (public.is_editor())
  with check (public.is_editor());
