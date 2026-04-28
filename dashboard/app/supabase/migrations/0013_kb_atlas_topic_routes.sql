-- Atlas — editor-curated topic → branch routes.
--
-- Today the API maps `sources.topic_category` to a branch via a hardcoded
-- regex. New topics that don't match get bucketed as "unmapped" forever.
-- This table lets editors teach the atlas: pick an unmapped topic, choose a
-- branch, and from then on every paper with that exact topic_category routes
-- to that branch automatically. The atlas learns from corrections.
--
-- Also adds a candidates table for Phase C (auto-discovered cross-links).

create table if not exists public.kb_atlas_topic_routes (
  id              uuid primary key default gen_random_uuid(),
  topic_pattern   text not null unique,            -- exact match on sources.topic_category (lowercased)
  branch_id       text not null references public.kb_atlas_branches(id) on delete cascade,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz default now()
);

create index if not exists kb_atlas_topic_routes_branch_idx on public.kb_atlas_topic_routes(branch_id);

alter table public.kb_atlas_topic_routes enable row level security;

create policy kb_atlas_topic_routes_read on public.kb_atlas_topic_routes
  for select to authenticated using (true);
create policy kb_atlas_topic_routes_write_editor on public.kb_atlas_topic_routes
  for all to authenticated using (public.is_editor()) with check (public.is_editor());

-- Cross-link candidates surfaced by the discovery job.
-- Editors review and either approve (move to kb_atlas_edges) or dismiss.
create table if not exists public.kb_atlas_edge_candidates (
  id              uuid primary key default gen_random_uuid(),
  source_node_id  text not null,
  target_node_id  text not null,
  similarity      numeric(4,3),                    -- max chunk-pair cosine
  rationale_draft text,                            -- LLM-generated explanation
  evidence_chunks uuid[],                          -- chunk ids that drove the candidate
  status          text default 'pending' check (status in ('pending','approved','dismissed')),
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz default now(),
  unique (source_node_id, target_node_id)
);

create index if not exists kb_atlas_candidates_status_idx on public.kb_atlas_edge_candidates(status);

alter table public.kb_atlas_edge_candidates enable row level security;

create policy kb_atlas_candidates_read on public.kb_atlas_edge_candidates
  for select to authenticated using (true);
create policy kb_atlas_candidates_write_editor on public.kb_atlas_edge_candidates
  for all to authenticated using (public.is_editor()) with check (public.is_editor());
