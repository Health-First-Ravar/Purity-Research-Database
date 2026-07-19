-- 0011_assignment_log_survives_user_deletion
--
-- `coa_assignment_log.actor` referenced `profiles(id)` with NO ACTION, so once
-- an editor had assigned anything they could never be removed from the system —
-- the delete failed with a foreign-key violation. Found while removing this
-- session's temporary verification user, which had written two audit rows.
--
-- Staff leave. An audit trail that blocks offboarding is one that will
-- eventually be worked around by deleting audit rows, which is worse than the
-- problem it was protecting against.
--
-- Fix: keep attribution as a durable text snapshot taken at write time, and let
-- the uuid reference null out when the profile goes. The record of WHO decided
-- survives the account; only the live join is lost.

alter table public.coa_assignment_log
  add column if not exists actor_email text;

-- Backfill from the profiles/auth pair while the references still resolve.
update public.coa_assignment_log l
   set actor_email = u.email
  from auth.users u
 where u.id = l.actor
   and l.actor_email is null;

-- Attribution now lives in actor_email, so the uuid may be null.
alter table public.coa_assignment_log alter column actor drop not null;

alter table public.coa_assignment_log
  drop constraint if exists coa_assignment_log_actor_fkey;

alter table public.coa_assignment_log
  add constraint coa_assignment_log_actor_fkey
  foreign key (actor) references public.profiles(id) on delete set null;

comment on column public.coa_assignment_log.actor is
  'Profile that made the decision. Nulled if the account is later deleted — '
  'attribution is preserved in actor_email.';

comment on column public.coa_assignment_log.actor_email is
  'Email captured at decision time. Survives account deletion, so the audit '
  'trail outlives the person. Never updated after the fact.';
