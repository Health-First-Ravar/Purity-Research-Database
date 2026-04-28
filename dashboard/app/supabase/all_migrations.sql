
-- ============================================================
-- 0001_initial.sql
-- ============================================================
-- Purity Dashboard — Initial Schema (v1)
-- Target: Supabase Postgres 15+ with pgvector
-- Roles: editor (review, curate canon, promote answers), user (customer-service agents)
--
-- Design principles:
--   * Single-DB architecture: vectors live in Postgres via pgvector (no separate vector store)
--   * Voyage voyage-3-large = 1024 dimensions
--   * canon_qa is a cache-before-LLM layer (fastest answer path)
--   * messages logs every chat turn (analytics + editor review + RLHF-lite)
--   * update_jobs tracks the daily cron + manual 3/day cap
--   * RLS: anonymous gets nothing; user-role reads canon/chunks, writes messages; editor does everything

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles — one row per authenticated user, mirrors auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  role        text not null default 'user' check (role in ('editor','user')),
  full_name   text,
  created_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);

-- Auto-create a profile row when auth.users gets a new row
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- sources — provenance for every ingested document
-- ---------------------------------------------------------------------------
create table if not exists public.sources (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in (
                      'research_paper','coffee_book','purity_brain','reva_skill',
                      'coa','product_pdf','faq','web','review','canon'
                    )),
  title             text not null,
  drive_file_id     text,                    -- Google Drive id (nullable for non-Drive)
  drive_url         text,
  chapter           text,                    -- '01'..'18','09.5' — mirrors research/coffee-book
  shortname         text,                    -- human-recognizable handle
  path              text,                    -- relative path inside knowledge-base/
  sha256            text,                    -- content hash; lets sync detect real changes
  metadata          jsonb not null default '{}'::jsonb,
  freshness_tier    text not null default 'stable' check (freshness_tier in (
                      'stable','weekly','batch'
                    )),
  valid_from        timestamptz not null default now(),
  valid_until       timestamptz,             -- null = currently-canonical version
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists sources_kind_idx       on public.sources(kind);
create index if not exists sources_drive_idx      on public.sources(drive_file_id);
create index if not exists sources_chapter_idx    on public.sources(chapter);
create index if not exists sources_freshness_idx  on public.sources(freshness_tier);
create index if not exists sources_valid_until_idx on public.sources(valid_until);

-- ---------------------------------------------------------------------------
-- chunks — retrievable units; every chunk is embedded
-- ---------------------------------------------------------------------------
create table if not exists public.chunks (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.sources(id) on delete cascade,
  chunk_index   int  not null,
  heading       text,                        -- nearest H2/H3 above the chunk
  content       text not null,
  token_count   int,
  embedding     vector(1024),                -- voyage-3-large
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (source_id, chunk_index)
);

-- HNSW index for cosine search
create index if not exists chunks_embedding_idx
  on public.chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists chunks_source_idx on public.chunks(source_id);

-- ---------------------------------------------------------------------------
-- canon_qa — curated Q&A cache; checked before falling through to LLM
-- ---------------------------------------------------------------------------
create table if not exists public.canon_qa (
  id                uuid primary key default gen_random_uuid(),
  question          text not null,
  answer            text not null,
  question_embed    vector(1024),            -- for semantic lookup
  tags              text[] not null default '{}',
  freshness_tier    text not null default 'stable' check (freshness_tier in (
                      'stable','weekly','batch'
                    )),
  scope             text not null default 'global' check (scope in ('global','blend','batch')),
  blend             text,                    -- 'PROTECT'|'FLOW'|'EASE'|'CALM' when scope='blend'
  batch_ref         text,                    -- batch/lot number when scope='batch'
  cited_chunk_ids   uuid[] not null default '{}',
  status            text not null default 'active' check (status in (
                      'draft','active','deprecated'
                    )),
  created_by        uuid references public.profiles(id),
  reviewed_by       uuid references public.profiles(id),
  last_reviewed_at  timestamptz,
  next_review_due   timestamptz,
  hit_count         int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists canon_qa_embedding_idx
  on public.canon_qa
  using hnsw (question_embed vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where status = 'active';

create index if not exists canon_qa_status_idx    on public.canon_qa(status);
create index if not exists canon_qa_blend_idx     on public.canon_qa(blend);
create index if not exists canon_qa_tags_idx      on public.canon_qa using gin(tags);
create index if not exists canon_qa_due_idx       on public.canon_qa(next_review_due) where status = 'active';

-- ---------------------------------------------------------------------------
-- messages — every chat turn, for logging + editor review + RLHF-lite
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null,              -- groups the 2-3 turn session context
  user_id               uuid references public.profiles(id),
  question              text not null,
  answer                text,
  canon_hit_id          uuid references public.canon_qa(id),
  retrieved_chunk_ids   uuid[] not null default '{}',
  cited_chunk_ids       uuid[] not null default '{}',
  confidence_score      numeric(3,2),               -- 0.00..1.00, from Sonnet structured output
  insufficient_evidence boolean not null default false,
  escalated             boolean not null default false,
  escalation_reason     text,                        -- 'low_confidence'|'editor_flag'|'user_flag'
  editor_label          text,                        -- 'good'|'bad'|'promote_to_canon'
  editor_note           text,
  editor_id             uuid references public.profiles(id),
  classification        text,                        -- 'coa'|'blend'|'health'|'product'|'other' (Haiku)
  latency_ms            int,
  tokens_in             int,
  tokens_out            int,
  cost_usd              numeric(10,6),
  created_at            timestamptz not null default now()
);

create index if not exists messages_session_idx        on public.messages(session_id, created_at);
create index if not exists messages_user_idx           on public.messages(user_id, created_at desc);
create index if not exists messages_escalation_idx     on public.messages(escalated) where escalated = true;
create index if not exists messages_editor_label_idx   on public.messages(editor_label);
create index if not exists messages_insufficient_idx   on public.messages(insufficient_evidence) where insufficient_evidence = true;

-- ---------------------------------------------------------------------------
-- reviews — mined customer-review evidence (deferred seed: stub structure)
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('purity','amazon','reddit','other')),
  external_id   text,                        -- upstream review id if present
  author_handle text,
  rating        numeric(2,1),
  title         text,
  body          text not null,
  body_embed    vector(1024),
  blend         text,
  themes        text[] not null default '{}',
  sentiment     text,                        -- 'positive'|'neutral'|'negative'
  posted_at     timestamptz,
  ingested_at   timestamptz not null default now()
);

create index if not exists reviews_source_idx   on public.reviews(source);
create index if not exists reviews_blend_idx    on public.reviews(blend);
create index if not exists reviews_themes_idx   on public.reviews using gin(themes);
create index if not exists reviews_embed_idx
  on public.reviews
  using hnsw (body_embed vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------------
-- update_jobs — daily cron + manual button (global 3/day cap)
-- ---------------------------------------------------------------------------
create table if not exists public.update_jobs (
  id              uuid primary key default gen_random_uuid(),
  trigger         text not null check (trigger in ('cron','manual')),
  triggered_by    uuid references public.profiles(id),
  status          text not null default 'pending' check (status in (
                    'pending','running','success','error'
                  )),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  sources_checked int not null default 0,
  sources_added   int not null default 0,
  sources_updated int not null default 0,
  chunks_embedded int not null default 0,
  error_message   text,
  metadata        jsonb not null default '{}'::jsonb
);

create index if not exists update_jobs_started_idx on public.update_jobs(started_at desc);
create index if not exists update_jobs_trigger_idx on public.update_jobs(trigger, started_at desc);

-- ---------------------------------------------------------------------------
-- coas — structured COA rows; powers the reports page
-- ---------------------------------------------------------------------------
create table if not exists public.coas (
  id                      uuid primary key default gen_random_uuid(),
  source_id               uuid references public.sources(id) on delete cascade,
  coffee_name             text,
  blend                   text,
  lot_number              text,
  report_number           text,
  report_date             date,
  origin                  text,
  -- contaminants (null = not reported that COA)
  ota_ppb                 numeric,
  aflatoxin_ppb           numeric,
  acrylamide_ppb          numeric,
  pesticides_detected     jsonb,
  heavy_metals            jsonb,
  -- bioactives
  cga_mg_g                numeric,
  melanoidins_mg_g        numeric,
  trigonelline_mg_g       numeric,
  caffeine_pct            numeric,
  -- QC
  moisture_pct            numeric,
  water_activity          numeric,
  -- catch-all
  raw_values              jsonb not null default '{}'::jsonb,
  lab                     text,
  created_at              timestamptz not null default now()
);

create index if not exists coas_blend_idx        on public.coas(blend);
create index if not exists coas_coffee_idx       on public.coas(coffee_name);
create index if not exists coas_date_idx         on public.coas(report_date desc);
create index if not exists coas_source_idx       on public.coas(source_id);

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.sources     enable row level security;
alter table public.chunks      enable row level security;
alter table public.canon_qa    enable row level security;
alter table public.messages    enable row level security;
alter table public.reviews     enable row level security;
alter table public.update_jobs enable row level security;
alter table public.coas        enable row level security;

-- Helper: is_editor()
create or replace function public.is_editor()
returns boolean
language sql
stable security definer set search_path = public
as $$
  select coalesce(
    (select role = 'editor' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- profiles: users see themselves; editors see all
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id or public.is_editor());
create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id);
create policy profiles_editor_all on public.profiles
  for all using (public.is_editor()) with check (public.is_editor());

-- sources: any authenticated user reads; editors write
create policy sources_read on public.sources
  for select using (auth.role() = 'authenticated');
create policy sources_editor_write on public.sources
  for all using (public.is_editor()) with check (public.is_editor());

-- chunks: same pattern as sources
create policy chunks_read on public.chunks
  for select using (auth.role() = 'authenticated');
create policy chunks_editor_write on public.chunks
  for all using (public.is_editor()) with check (public.is_editor());

-- canon_qa: active rows readable by all auth'd; draft/deprecated editors only
create policy canon_qa_read_active on public.canon_qa
  for select using (auth.role() = 'authenticated' and (status = 'active' or public.is_editor()));
create policy canon_qa_editor_write on public.canon_qa
  for all using (public.is_editor()) with check (public.is_editor());

-- messages: users see their own; editors see all; inserts allowed for any auth'd
create policy messages_self_read on public.messages
  for select using (user_id = auth.uid() or public.is_editor());
create policy messages_insert on public.messages
  for insert with check (auth.role() = 'authenticated');
create policy messages_editor_update on public.messages
  for update using (public.is_editor()) with check (public.is_editor());

-- reviews: read-only for all auth'd; editors write
create policy reviews_read on public.reviews
  for select using (auth.role() = 'authenticated');
create policy reviews_editor_write on public.reviews
  for all using (public.is_editor()) with check (public.is_editor());

-- update_jobs: editors only (both triggers and reads)
create policy update_jobs_editor on public.update_jobs
  for all using (public.is_editor()) with check (public.is_editor());

-- coas: any auth'd reads (reports page); editors write
create policy coas_read on public.coas
  for select using (auth.role() = 'authenticated');
create policy coas_editor_write on public.coas
  for all using (public.is_editor()) with check (public.is_editor());

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists sources_touch on public.sources;
create trigger sources_touch before update on public.sources
  for each row execute function public.touch_updated_at();

drop trigger if exists canon_qa_touch on public.canon_qa;
create trigger canon_qa_touch before update on public.canon_qa
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RPC: match_chunks — cosine similarity retrieval
-- ---------------------------------------------------------------------------
create or replace function public.match_chunks(
  query_embedding vector(1024),
  match_count     int default 8,
  source_kinds    text[] default null,
  min_similarity  float default 0.5
)
returns table (
  id          uuid,
  source_id   uuid,
  heading     text,
  content     text,
  similarity  float,
  kind        text,
  title       text,
  chapter     text
)
language sql stable security invoker as $$
  select
    c.id,
    c.source_id,
    c.heading,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity,
    s.kind,
    s.title,
    s.chapter
  from public.chunks c
  join public.sources s on s.id = c.source_id
  where
    (source_kinds is null or s.kind = any(source_kinds))
    and s.valid_until is null
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- RPC: match_canon — canon cache semantic lookup
-- ---------------------------------------------------------------------------
create or replace function public.match_canon(
  query_embedding vector(1024),
  match_count     int default 3,
  min_similarity  float default 0.80
)
returns table (
  id          uuid,
  question    text,
  answer      text,
  similarity  float,
  freshness_tier text,
  next_review_due timestamptz
)
language sql stable security invoker as $$
  select
    q.id,
    q.question,
    q.answer,
    1 - (q.question_embed <=> query_embedding) as similarity,
    q.freshness_tier,
    q.next_review_due
  from public.canon_qa q
  where
    q.status = 'active'
    and 1 - (q.question_embed <=> query_embedding) >= min_similarity
  order by q.question_embed <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- RPC: can_trigger_manual_update — enforces global 3/day cap
-- ---------------------------------------------------------------------------
create or replace function public.can_trigger_manual_update()
returns boolean
language sql stable security invoker as $$
  select (
    select count(*) from public.update_jobs
    where trigger = 'manual'
      and started_at > now() - interval '24 hours'
  ) < 3;
$$;

-- ============================================================
-- 0002_bibliography.sql
-- ============================================================
-- Bibliography expansion: fold in Jeremy's 448-article catalog.
-- Adds first-class columns for DOI + topic organization + rights flags so the
-- Bibliography page can filter and badge without digging into metadata jsonb.

alter table public.sources
  add column if not exists doi                text,
  add column if not exists year_published     int,
  add column if not exists topic_category     text,   -- fine-grained: "Diabetes / Systematic Review"
  add column if not exists drive_location     text,   -- high-level: "Type II Diabetes", "Cancer", etc.
  add column if not exists rights_share       text,   -- "Yes" | "Yes - CC BY" | "No" | "Limited" | "Partial"
  add column if not exists rights_download    text,   -- "Yes - Open Access" | "Yes - Free via PMC" | "No - Subscription" ...
  add column if not exists database_platform  text,   -- "PubMed / JAMA", etc.
  add column if not exists has_pdf            boolean not null default false;

create unique index if not exists sources_doi_uniq
  on public.sources(doi)
  where doi is not null and valid_until is null;

create index if not exists sources_topic_category_idx on public.sources(topic_category);
create index if not exists sources_drive_location_idx on public.sources(drive_location);
create index if not exists sources_year_idx           on public.sources(year_published);
create index if not exists sources_rights_download_idx on public.sources(rights_download);

-- Convenience view: the bibliography row shape the UI wants.
create or replace view public.bibliography_view as
  select
    id,
    title,
    doi,
    year_published,
    topic_category,
    drive_location,
    rights_share,
    rights_download,
    database_platform,
    has_pdf,
    drive_url,
    kind,
    created_at
  from public.sources
  where kind in ('research_paper','coffee_book')
    and valid_until is null;

grant select on public.bibliography_view to authenticated;

-- ============================================================
-- 0003_research_doi_duplicates.sql
-- ============================================================
-- Dedupe pass for the research/ corpus surfaced two intentional DOI duplicates:
-- the same paper ingested under two chapter contexts (ch09.5-paper-c ≈ ch10-paper-a,
-- ch10-paper-b ≈ t2d-coffee). Per knowledge-base/README.md, chapter context is a
-- retrieval concern and the duplication is intentional for that reason.
--
-- We allow duplicate DOIs across sources rows, but keep DOI-uniqueness on the
-- bibliography catalog level by deduplicating in bibliography_view.

drop index if exists public.sources_doi_uniq;

-- Non-unique lookup index, still partial on active rows for hot-path queries.
create index if not exists sources_doi_idx
  on public.sources(doi)
  where doi is not null and valid_until is null;

-- Bibliography view: one row per DOI. Preference order:
--   1) rows with has_pdf = true (ingested, full-text queryable)
--   2) then earliest chapter (alphabetical — '03' before '10')
--   3) then earliest created_at (import order)
-- Rows without a DOI pass through unchanged (they can't collide).
create or replace view public.bibliography_view as
  with active as (
    select
      id, title, doi, year_published, topic_category, drive_location,
      rights_share, rights_download, database_platform, has_pdf,
      drive_url, kind, chapter, created_at
    from public.sources
    where kind in ('research_paper','coffee_book')
      and valid_until is null
  ),
  ranked as (
    select distinct on (doi)
      *
    from active
    where doi is not null
    order by doi, has_pdf desc, chapter asc nulls last, created_at asc
  ),
  no_doi as (
    select * from active where doi is null
  )
  select
    id, title, doi, year_published, topic_category, drive_location,
    rights_share, rights_download, database_platform, has_pdf,
    drive_url, kind, created_at
  from ranked
  union all
  select
    id, title, doi, year_published, topic_category, drive_location,
    rights_share, rights_download, database_platform, has_pdf,
    drive_url, kind, created_at
  from no_doi;

grant select on public.bibliography_view to authenticated;

-- ============================================================
-- 0004_chat_feedback_and_metrics.sql
-- ============================================================
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

-- ============================================================
-- 0005_rate_limits.sql
-- ============================================================
-- 0005: Rate limiting for /api/chat (and any future LLM-backed route).
--
-- Design: sliding-window counter with minute granularity. Cheap to read,
-- cheap to write, idempotent under concurrent requests via ON CONFLICT.
--
-- Per-user per-minute cap (CHAT_RPM_LIMIT, default 30) and a per-user
-- per-day cap (CHAT_DPM_LIMIT, default 500) together bound cost.
--
-- A single RPC, check_and_increment_rate_limit(user_id, bucket_key, limit_rpm,
-- limit_rpd), does both checks in one round-trip.

begin;

create table if not exists public.rate_limits (
  user_id      uuid not null references auth.users(id) on delete cascade,
  bucket_key   text not null,                           -- e.g. 'chat', future 'embed'
  window_start timestamptz not null,                    -- truncated to the minute
  count        int not null default 0,
  primary key (user_id, bucket_key, window_start)
);

create index if not exists rate_limits_window_idx
  on public.rate_limits(window_start desc);

-- Retention: keep 48h. Older rows are cleanable via a cron job (keeps the
-- table small and the index tight). Idempotent to call.
create or replace function public.prune_rate_limits()
returns void
language sql security definer set search_path = public
as $$
  delete from public.rate_limits
  where window_start < now() - interval '48 hours';
$$;

-- RLS: users can read their own rows (for debugging), nobody writes directly.
alter table public.rate_limits enable row level security;

create policy rate_limits_self_read on public.rate_limits
  for select using (user_id = auth.uid() or public.is_editor());

-- RPC: atomic check-and-increment.
-- Returns { allowed boolean, rpm_remaining int, rpd_remaining int,
--           retry_after_seconds int }. Called by the API route.
create or replace function public.check_and_increment_rate_limit(
  p_bucket_key text,
  p_limit_rpm int,
  p_limit_rpd int
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_minute  timestamptz := date_trunc('minute', now());
  v_minute_count int;
  v_day_count    int;
  v_seconds_until_next_min int;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Count requests in the current minute (before our increment).
  select coalesce(sum(count), 0)
    into v_minute_count
    from public.rate_limits
   where user_id = v_user_id
     and bucket_key = p_bucket_key
     and window_start = v_minute;

  -- Count requests in the last 24 hours.
  select coalesce(sum(count), 0)
    into v_day_count
    from public.rate_limits
   where user_id = v_user_id
     and bucket_key = p_bucket_key
     and window_start >= now() - interval '24 hours';

  if v_minute_count >= p_limit_rpm then
    v_seconds_until_next_min := ceil(extract(epoch from (v_minute + interval '1 minute' - now())))::int;
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rpm_exceeded',
      'rpm_remaining', 0,
      'rpd_remaining', greatest(p_limit_rpd - v_day_count, 0),
      'retry_after_seconds', v_seconds_until_next_min
    );
  end if;

  if v_day_count >= p_limit_rpd then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rpd_exceeded',
      'rpm_remaining', greatest(p_limit_rpm - v_minute_count, 0),
      'rpd_remaining', 0,
      'retry_after_seconds', 3600  -- client should back off an hour
    );
  end if;

  -- Increment atomically.
  insert into public.rate_limits (user_id, bucket_key, window_start, count)
       values (v_user_id, p_bucket_key, v_minute, 1)
  on conflict (user_id, bucket_key, window_start)
    do update set count = public.rate_limits.count + 1;

  return jsonb_build_object(
    'allowed', true,
    'rpm_remaining', p_limit_rpm - v_minute_count - 1,
    'rpd_remaining', p_limit_rpd - v_day_count - 1,
    'retry_after_seconds', 0
  );
end;
$$;

grant execute on function public.check_and_increment_rate_limit(text, int, int) to authenticated;
grant execute on function public.prune_rate_limits() to service_role;

commit;

-- ============================================================
-- 0006_escalation_audit.sql
-- ============================================================
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

-- ============================================================
-- 0007_canon_provenance.sql
-- ============================================================
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

-- ============================================================
-- 0008_coa_mapping_rules.sql
-- ============================================================
-- COA mapping rules — pattern-based assignment of origin/region to coffees
-- by matching sample_name / coffee_name. Blend is intentionally excluded
-- (it's seasonal — assigned per-batch, not per-coffee).

alter table public.coas
  add column if not exists region text;

create index if not exists coas_origin_idx on public.coas(origin);
create index if not exists coas_region_idx on public.coas(region);

create table if not exists public.coa_mapping_rules (
  id            uuid primary key default gen_random_uuid(),
  pattern       text not null,
  pattern_type  text not null default 'contains'
                check (pattern_type in ('contains', 'regex')),
  origin        text,
  region        text,
  notes         text,
  priority      int  not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists coa_mapping_rules_priority_idx
  on public.coa_mapping_rules(priority);

alter table public.coa_mapping_rules enable row level security;

drop policy if exists "coa_mapping_rules read all" on public.coa_mapping_rules;
create policy "coa_mapping_rules read all"
  on public.coa_mapping_rules for select
  using (true);

drop policy if exists "coa_mapping_rules editor write" on public.coa_mapping_rules;
create policy "coa_mapping_rules editor write"
  on public.coa_mapping_rules for all
  using (public.is_editor())
  with check (public.is_editor());

-- Server-side rule application: evaluates every rule against every COA in
-- priority order (lowest first), first match wins per field. Returns updated
-- row count. Editor-only.
create or replace function public.apply_coa_mapping_rules()
returns table(updated_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if not public.is_editor() then
    raise exception 'editor role required';
  end if;

  with matched as (
    select distinct on (c.id)
      c.id,
      r.origin as new_origin,
      r.region as new_region
    from public.coas c
    left join public.coa_mapping_rules r on (
      (r.pattern_type = 'contains'
        and (c.coffee_name ilike '%' || r.pattern || '%'))
      or
      (r.pattern_type = 'regex'
        and (c.coffee_name ~* r.pattern))
    )
    where r.id is not null
    order by c.id, r.priority asc
  )
  update public.coas c
     set origin = coalesce(m.new_origin, c.origin),
         region = coalesce(m.new_region, c.region)
    from matched m
   where c.id = m.id;

  get diagnostics v_count = row_count;
  return query select v_count;
end;
$$;

grant execute on function public.apply_coa_mapping_rules() to authenticated;
