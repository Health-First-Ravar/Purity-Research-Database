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
