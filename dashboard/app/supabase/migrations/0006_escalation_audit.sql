-- 0006: Escalation audit trail.
--
-- Every editor action on an escalated message gets a row here so we can
-- reconstruct: who picked this up, when they labeled it, whether it was
-- promoted to canon, how long it took, whether it was later reopened.
--
-- Feeding source: the messages table + /api/editor/label route. We add a
-- trigger that captures transitions on editor_label.

begin;

create table if not exists public.escalation_events (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages(id) on delete cascade,
  event_type    text not null check (event_type in (
                  'escalated',      -- message entered the queue (auto)
                  'claimed',        -- editor opened it (client emits)
                  'labeled',        -- editor_label set
                  'promoted',       -- promoted to canon_qa
                  'reopened',       -- editor_label cleared
                  'resolved',       -- explicit close without label (rare)
                  'note'            -- free-text annotation
                )),
  actor_id      uuid references public.profiles(id),
  old_value     text,
  new_value     text,
  note          text,
  canon_id      uuid references public.canon_qa(id),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists escalation_events_msg_idx on public.escalation_events(message_id, created_at);
create index if not exists escalation_events_actor_idx on public.escalation_events(actor_id, created_at desc);
create index if not exists escalation_events_type_idx on public.escalation_events(event_type);

alter table public.escalation_events enable row level security;

create policy escalation_events_editor_all on public.escalation_events
  for all using (public.is_editor()) with check (public.is_editor());

-- Trigger: when a message's editor_label changes, emit a row.
create or replace function public.log_editor_label_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.editor_label is distinct from old.editor_label then
    insert into public.escalation_events
      (message_id, event_type, actor_id, old_value, new_value, note)
    values
      (
        new.id,
        case
          when new.editor_label is null then 'reopened'
          when new.editor_label = 'promote_to_canon' then 'promoted'
          else 'labeled'
        end,
        new.editor_id,
        old.editor_label,
        new.editor_label,
        new.editor_note
      );
  end if;

  -- First time escalated flips true, log the escalation.
  if tg_op = 'UPDATE' and new.escalated and not old.escalated then
    insert into public.escalation_events (message_id, event_type, new_value, note)
    values (new.id, 'escalated', new.escalation_reason, null);
  end if;

  if tg_op = 'INSERT' and new.escalated then
    insert into public.escalation_events (message_id, event_type, new_value, note)
    values (new.id, 'escalated', new.escalation_reason, null);
  end if;

  return new;
end;
$$;

drop trigger if exists messages_log_label_change on public.messages;
create trigger messages_log_label_change
  after insert or update on public.messages
  for each row execute function public.log_editor_label_change();

-- Helper view: one row per message with the latest state for the queue.
create or replace view public.escalation_queue_view as
select
  m.id                              as message_id,
  m.session_id,
  m.question,
  m.answer,
  m.classification,
  m.confidence_score,
  m.escalation_reason,
  m.insufficient_evidence,
  m.editor_label,
  m.editor_note,
  m.editor_id,
  editor_profile.email              as editor_email,
  m.created_at                      as escalated_at,
  (
    select count(*) from public.escalation_events e
    where e.message_id = m.id
  )                                 as event_count,
  (
    select max(e.created_at) from public.escalation_events e
    where e.message_id = m.id
  )                                 as last_event_at
from public.messages m
left join public.profiles editor_profile on editor_profile.id = m.editor_id
where m.escalated = true;

comment on view public.escalation_queue_view is
  'Escalation queue with editor identity and event count. Editor UI source.';

grant select on public.escalation_queue_view to authenticated;

commit;
