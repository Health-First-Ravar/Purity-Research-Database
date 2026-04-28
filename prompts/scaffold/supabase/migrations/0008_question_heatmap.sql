-- 0008: Question Heatmap — demand vs. supply across health-first coffee topics.
--
-- question_topics  = canonical taxonomy (~40 slugs across compound /
--                    contaminant / blend / process / health_outcome / operations)
-- message_topics   = many-to-many assignment from messages to topics; written
--                    by the Haiku classifier on each chat turn (and by a
--                    backfill pass for historical messages)
-- question_heatmap = per-topic view that joins demand (msg counts, miss rate)
--                    against supply (active canon_qa rows tagged with the slug)
--                    and emits a `canon_gap` boolean (>=3 msgs in 30d AND zero canon)

begin;

-- ---------------------------------------------------------------------------
-- topics dictionary
-- ---------------------------------------------------------------------------
create table if not exists public.question_topics (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  label        text not null,
  category     text not null check (category in (
                  'compound','contaminant','blend','process','health_outcome','operations'
                )),
  description  text,
  created_at   timestamptz not null default now()
);

create index if not exists question_topics_category_idx on public.question_topics(category);

-- ---------------------------------------------------------------------------
-- message ↔ topic assignment
-- ---------------------------------------------------------------------------
create table if not exists public.message_topics (
  message_id   uuid not null references public.messages(id) on delete cascade,
  topic_id     uuid not null references public.question_topics(id) on delete cascade,
  confidence   numeric(3,2) not null default 0.50,
  source       text not null default 'auto' check (source in ('auto','editor','backfill')),
  created_at   timestamptz not null default now(),
  primary key (message_id, topic_id)
);

create index if not exists message_topics_topic_idx on public.message_topics(topic_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.question_topics enable row level security;
alter table public.message_topics  enable row level security;

create policy qt_read on public.question_topics
  for select using (auth.role() = 'authenticated');
create policy qt_editor on public.question_topics
  for all using (public.is_editor()) with check (public.is_editor());

-- A user can see message_topics rows that point at their own messages; editors see all.
create policy mt_read on public.message_topics
  for select using (
    public.is_editor()
    or exists (
      select 1 from public.messages m
      where m.id = message_topics.message_id and m.user_id = auth.uid()
    )
  );
create policy mt_editor on public.message_topics
  for all using (public.is_editor()) with check (public.is_editor());

-- ---------------------------------------------------------------------------
-- heatmap view: demand vs. supply per topic
-- ---------------------------------------------------------------------------
create or replace view public.question_heatmap as
with demand as (
  select
    qt.id, qt.slug, qt.label, qt.category, qt.description,
    count(distinct mt.message_id) filter (where m.created_at > now() - interval '30 days') as msg_count_30d,
    count(distinct mt.message_id) filter (where m.created_at > now() - interval '7  days') as msg_count_7d,
    count(distinct mt.message_id)                                                          as msg_count_total,
    count(distinct mt.message_id) filter (where m.user_rating = -1)                        as thumbs_down_total,
    count(distinct mt.message_id) filter (where m.escalated)                               as escalated_total
  from public.question_topics qt
  left join public.message_topics mt on mt.topic_id = qt.id
  left join public.messages m        on m.id = mt.message_id
  group by qt.id
),
supply as (
  select
    qt.id,
    count(*) filter (where c.status = 'active') as canon_count,
    count(*) filter (where c.status = 'draft')  as canon_draft_count
  from public.question_topics qt
  left join public.canon_qa c on qt.slug = any(c.tags)
  group by qt.id
)
select
  d.id, d.slug, d.label, d.category, d.description,
  d.msg_count_30d, d.msg_count_7d, d.msg_count_total,
  d.thumbs_down_total, d.escalated_total,
  s.canon_count, s.canon_draft_count,
  case when d.msg_count_total > 0
       then round(d.thumbs_down_total::numeric / d.msg_count_total, 3)
  end as miss_rate,
  case when s.canon_count = 0 and d.msg_count_30d >= 3 then true else false end as canon_gap,
  -- priority score: demand × (gap + miss_rate); higher = more urgent to write
  round(
    (d.msg_count_30d::numeric)
    * (case when s.canon_count = 0 then 1.5 else 1.0 end)
    * (1.0 + coalesce(d.thumbs_down_total::numeric / nullif(d.msg_count_total, 0), 0))
  , 2) as priority_score
from demand d join supply s on s.id = d.id;

grant select on public.question_heatmap to authenticated;

comment on view public.question_heatmap is
  'Per-topic demand (recent + total messages, miss rate) vs. supply (canon coverage). canon_gap = true => write canon for this topic.';

commit;
