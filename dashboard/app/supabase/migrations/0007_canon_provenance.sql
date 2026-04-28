-- 0007: Canon provenance + rejected event type.
--
-- Adds origin_message_id to canon_qa so editors can trace a draft back to the
-- chat turn that produced it. Also expands the escalation_events event_type
-- check to include 'rejected' for the canon review flow.

begin;

-- Provenance: which message did this canon row originate from?
alter table public.canon_qa
  add column if not exists origin_message_id uuid references public.messages(id) on delete set null;

-- Index so editors can quickly link canon ↔ message.
create index if not exists canon_qa_origin_idx on public.canon_qa(origin_message_id) where origin_message_id is not null;

-- Expand event_type to include 'rejected' (canon review action).
alter table public.escalation_events
  drop constraint if exists escalation_events_event_type_check;

alter table public.escalation_events
  add constraint escalation_events_event_type_check
  check (event_type in (
    'escalated',
    'claimed',
    'labeled',
    'promoted',
    'reopened',
    'resolved',
    'note',
    'rejected'
  ));

commit;
