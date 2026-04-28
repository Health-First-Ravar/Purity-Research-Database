-- 0018: rename role tiers around an "admin" top tier.
--
-- Final role set (column constraint allows legacy values for safety, but the
-- app only emits these three):
--   admin            — full access (Jeremy + Ildi). Only role with users + metrics + ask-reva.
--   editor           — back-office: heatmap, canon, editor queue, atlas, bibliography, reports, audit.
--                      Explicitly NOT research-hub chat, NOT ask-reva, NOT users, NOT metrics.
--   customer_service — research hub + reports + bibliography + audit.
--
-- Anything that was 'editor' before this migration becomes 'admin' (those rows
-- had full access). Any 'researcher' rows collapse to 'editor' (closest scope).

-- Allow the new 'admin' value (legacy values stay in the check for safety;
-- the app stops emitting them).
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'customer_service', 'researcher', 'editor', 'admin'));

-- Step 1: Promote existing editors to admin. They had full access; keep it.
update public.profiles set role = 'admin' where role = 'editor';

-- Step 2: Researcher -> editor (closest match in the new scheme).
update public.profiles set role = 'editor' where role = 'researcher';

-- Step 3: Redefine helpers.
-- is_admin: strict admin-only (users, metrics, ask-reva).
create or replace function public.is_admin() returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- is_editor: elevated content access. Admin OR editor.
-- Existing RLS policies that use is_editor() automatically grant the new editor
-- the same content access admin has, EXCEPT the policies on
-- kb_atlas_layout, claim_audits (none use is_admin), users — those are all
-- gated at the API layer with is_admin checks anyway.
create or replace function public.is_editor() returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'editor')
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_editor() to authenticated;
