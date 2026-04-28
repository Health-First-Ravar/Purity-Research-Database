-- 0009: Ask Reva — operator-mode chat surface for Jeremy and Ildi.
--
-- Separate from the customer-service /chat. Editor-only. Three modes:
-- create / analyze / challenge — driven by sections of the Reva SKILL.md.
-- Retrieval can lean toward brand+skill (create) or evidence (analyze/challenge);
-- assistant turns may "leave the evidence" to synthesize, with an explicit flag.

begin;

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
create table if not exists public.reva_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  title         text,
  default_mode  text not null default 'analyze' check (default_mode in ('create','analyze','challenge')),
  pinned        boolean not null default false,
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists reva_sessions_user_idx on public.reva_sessions(user_id, updated_at desc);
create index if not exists reva_sessions_pinned_idx on public.reva_sessions(user_id, pinned desc, updated_at desc);

drop trigger if exists reva_sessions_touch on public.reva_sessions;
create trigger reva_sessions_touch before update on public.reva_sessions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table if not exists public.reva_messages (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.reva_sessions(id) on delete cascade,
  user_id             uuid references public.profiles(id),
  role                text not null check (role in ('user','assistant','system')),
  mode                text check (mode in ('create','analyze','challenge')),
  content             text not null,
  retrieved_chunk_ids uuid[] not null default '{}',
  cited_chunk_ids     uuid[] not null default '{}',
  flags               jsonb not null default '{}'::jsonb,
  -- common flags shape:
  --   { "left_evidence": bool, "regulatory_risk": bool, "weakest_link": "evidence"|... }
  tokens_in           int,
  tokens_out          int,
  cost_usd            numeric(10,6),
  latency_ms          int,
  created_at          timestamptz not null default now()
);

create index if not exists reva_messages_session_idx on public.reva_messages(session_id, created_at);
create index if not exists reva_messages_role_idx on public.reva_messages(role);

-- ---------------------------------------------------------------------------
-- RLS — editor-only on both tables
-- ---------------------------------------------------------------------------
alter table public.reva_sessions enable row level security;
alter table public.reva_messages enable row level security;

create policy reva_sessions_editor on public.reva_sessions
  for all using (public.is_editor()) with check (public.is_editor());
create policy reva_messages_editor on public.reva_messages
  for all using (public.is_editor()) with check (public.is_editor());

comment on table public.reva_sessions is
  'Operator-mode chat sessions for editors. Mode toggles drive system prompt + retrieval weights.';
comment on table public.reva_messages is
  'Turns within a reva_session. flags.left_evidence = true when assistant synthesized beyond chunks.';

commit;
