-- 0017: three role levels (replacing the binary user/editor split).
--
--   editor           — everything; only role that can manage users + see metrics
--   researcher       — everything else (atlas, heatmap, ask-reva, canon, editor queue, audit, reports, bibliography, chat)
--   customer_service — research-hub-side only (chat, reports, bibliography, audit)
--
-- Existing 'user' rows migrate to 'customer_service' since that's the closest
-- new equivalent. The DB helper `is_editor()` is redefined to grant both
-- editor AND researcher elevated content access — that way every existing
-- RLS policy that uses is_editor() automatically gives researcher the same
-- access as editor for content surfaces. A new helper `is_admin()` is the
-- strict editor-only gate, used for `kb_atlas_layout`, user management, and
-- metrics.

-- Allow the new role values
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'customer_service', 'researcher', 'editor'));

-- Migrate legacy 'user' rows. ('user' stays in the check constraint so any
-- pre-existing data isn't orphaned — but the app stops emitting it.)
update public.profiles set role = 'customer_service' where role = 'user';

-- is_editor() now returns true for both editor and researcher.
-- This is the elevated-content-access gate.
create or replace function public.is_editor() returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('editor', 'researcher')
  );
$$;

-- is_admin() — strict editor-only. Used for users + metrics.
create or replace function public.is_admin() returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'editor'
  );
$$;

grant execute on function public.is_admin() to authenticated;
