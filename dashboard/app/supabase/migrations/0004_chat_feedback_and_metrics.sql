-- 0004: Chat feedback loop + observability views.
--
-- Design decision: the `messages` table already carries every observability
-- field we need (latency_ms, tokens_in, tokens_out, cost_usd, confidence_score,
-- escalated, escalation_reason, classification, canon_hit_id). We do NOT add a
-- separate chat_events table — we add user-rating columns to messages and
-- build views on top.
--
-- New columns on messages:
--   user_rating       — end-user thumbs-up/down on their own answer (+1/-1/null)
--   user_rating_note  — optional free text from the user explaining the rating
--   user_rated_at     — timestamp, lets us measure time-to-rating
--
-- New views:
--   daily_chat_metrics   — per-day rollup of canon-hit %, escalation %, latency
--   promotion_candidates — messages worth promoting to canon (thumbs-up +
--                          not-already-canon + not-escalated)
--   canon_misses         — messages where thumbs-down OR escalated (for review)

begin;

-- ---------------------------------------------------------------------------
-- user rating columns
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists user_rating      smallint check (user_rating in (-1, 1)),
  add column if not exists user_rating_note text,
  add column if not exists user_rated_at    timestamptz;

create index if not exists messages_user_rating_idx
  on public.messages(user_rating) where user_rating is not null;

-- ---------------------------------------------------------------------------
-- RLS: users can update their own rows; editors already have full update.
-- A trigger below restricts non-editors to only the rating columns.
-- ---------------------------------------------------------------------------
drop policy if exists messages_user_rate_own on public.messages;
create policy messages_user_rate_own on public.messages
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Column-scope enforcement: non-editors may only change user_rating,
-- user_rating_note, user_rated_at. Everything else must match the old row.
create or replace function public.restrict_message_user_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Editors skip the check.
  if public.is_editor() then
    return new;
  end if;

  -- Only the caller owns this row (RLS already enforces that).
  -- Disallow changes to any non-rating column.
  if
    new.session_id            is distinct from old.session_id            or
    new.user_id               is distinct from old.user_id               or
    new.question              is distinct from old.question              or
    new.answer                is distinct from old.answer                or
    new.canon_hit_id          is distinct from old.canon_hit_id          or
    new.retrieved_chunk_ids   is distinct from old.retrieved_chunk_ids   or
    new.cited_chunk_ids       is distinct from old.cited_chunk_ids       or
    new.confidence_score      is distinct from old.confidence_score      or
    new.insufficient_evidence is distinct from old.insufficient_evidence or
    new.escalated             is distinct from old.escalated             or
    new.escalation_reason     is distinct from old.escalation_reason     or
    new.editor_label          is distinct from old.editor_label          or
    new.editor_note           is distinct from old.editor_note           or
    new.editor_id             is distinct from old.editor_id             or
    new.classification        is distinct from old.classification        or
    new.latency_ms            is distinct from old.latency_ms            or
    new.tokens_in             is distinct from old.tokens_in             or
    new.tokens_out            is distinct from old.tokens_out            or
    new.cost_usd              is distinct from old.cost_usd              or
    new.created_at            is distinct from old.created_at
  then
    raise exception 'non-editors may only update user_rating / user_rating_note / user_rated_at';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_restrict_user_update on public.messages;
create trigger messages_restrict_user_update
  before update on public.messages
  for each row execute function public.restrict_message_user_update();

-- ---------------------------------------------------------------------------
-- daily_chat_metrics view — the one-query answer to "how are we doing?"
-- ---------------------------------------------------------------------------
create or replace view public.daily_chat_metrics as
select
  date_trunc('day', created_at)::date as day,
  count(*)                                               as total_messages,
  count(*) filter (where canon_hit_id is not null)       as canon_hits,
  count(*) filter (where canon_hit_id is null)           as llm_calls,
  count(*) filter (where escalated)                      as escalations,
  count(*) filter (where insufficient_evidence)          as insufficient_evidence_count,
  count(*) filter (where user_rating = 1)                as thumbs_up,
  count(*) filter (where user_rating = -1)               as thumbs_down,
  round(avg(latency_ms)::numeric, 0)                     as avg_latency_ms,
  round(percentile_cont(0.5) within group (order by latency_ms)::numeric, 0) as p50_latency_ms,
  round(percentile_cont(0.95) within group (order by latency_ms)::numeric, 0) as p95_latency_ms,
  round(avg(confidence_score)::numeric, 3)               as avg_confidence,
  sum(tokens_in)                                         as total_tokens_in,
  sum(tokens_out)                                        as total_tokens_out,
  round(sum(cost_usd)::numeric, 4)                       as total_cost_usd
from public.messages
group by 1
order by 1 desc;

comment on view public.daily_chat_metrics is
  'One row per day. Canon-hit rate = canon_hits / total_messages. Use this for the metrics page.';

-- ---------------------------------------------------------------------------
-- promotion_candidates view — thumbs-up messages not yet in canon
-- ---------------------------------------------------------------------------
create or replace view public.promotion_candidates as
select
  m.id                as message_id,
  m.question,
  m.answer,
  m.classification,
  m.confidence_score,
  m.cited_chunk_ids,
  m.user_rating,
  m.user_rating_note,
  m.created_at,
  m.user_id,
  m.session_id
from public.messages m
where
  m.user_rating = 1
  and m.answer is not null
  and m.canon_hit_id is null        -- not already from canon
  and not m.escalated               -- not a failure
  and m.editor_label is null        -- editor hasn't yet ruled on it
order by m.created_at desc;

comment on view public.promotion_candidates is
  'Messages the user gave thumbs-up to that aren''t already canon. Editor review queue.';

-- ---------------------------------------------------------------------------
-- canon_misses view — thumbs-down OR escalated, for review
-- ---------------------------------------------------------------------------
create or replace view public.canon_misses as
select
  m.id                as message_id,
  m.question,
  m.answer,
  m.classification,
  m.confidence_score,
  m.escalated,
  m.escalation_reason,
  m.insufficient_evidence,
  m.user_rating,
  m.user_rating_note,
  m.created_at,
  m.user_id
from public.messages m
where
  m.user_rating = -1
  or m.escalated
  or m.insufficient_evidence
order by m.created_at desc;

comment on view public.canon_misses is
  'Questions the system answered poorly. Editor triage source. Fix = promote a corrected canon row.';

-- Explicit grants. The underlying tables' RLS still applies — these are just
-- the "can you select from this view" permission.
grant select on public.daily_chat_metrics   to authenticated;
grant select on public.promotion_candidates to authenticated;
grant select on public.canon_misses         to authenticated;

commit;
