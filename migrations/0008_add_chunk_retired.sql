-- 0008_add_chunk_retired
--
-- Reversible soft-retire for `chunks`.
--
-- When `embed-coas` re-renders a COA whose text has changed it retires the old
-- `sources` row (`valid_until`) and inserts a new one, but it only deletes
-- chunks belonging to the NEW source id. The old source's chunks survive, so
-- stale embeddings of our own products accumulate on every content change.
--
-- `match_chunks` already excludes them via `s.valid_until is null`, so this is
-- not a live retrieval defect. It is dead weight, and it is one forgotten join
-- condition away from becoming one — any future query that reads `chunks`
-- without going through the sources filter would surface outdated text for a
-- current product.
--
-- Mirrors `coas.retired_at` and `sources.valid_until`: stamp a timestamp, keep
-- the row. Reverse with `set retired_at = null`.

alter table public.chunks
  add column if not exists retired_at     timestamptz,
  add column if not exists retired_reason text;

-- Partial index: reads want live rows, so index the exception.
create index if not exists chunks_retired_at_idx
  on public.chunks (retired_at) where retired_at is not null;

comment on column public.chunks.retired_at is
  'When set, this chunk is withdrawn from retrieval but preserved. Used for '
  'stale embeddings left behind when a source was superseded. Reverse with: '
  'update public.chunks set retired_at = null, retired_reason = null where id = ...';

-- ---------------------------------------------------------------------------
-- Retrieval must honour it directly, not only via the source's valid_until.
-- The whole point is to be robust to a caller that forgets the source join.
-- ---------------------------------------------------------------------------
create or replace function public.match_chunks(
  query_embedding    vector(1024),
  match_count        int default 8,
  source_kinds       text[] default null,
  min_similarity     float default 0.5,
  allowed_coa_scopes text[] default null
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
language plpgsql stable security invoker as $$
declare
  effective_scopes text[];
begin
  -- auth.uid() is null for service_role (ingestion, admin scripts) and anon.
  -- service_role bypasses RLS and is trusted; anon is blocked from `chunks` by
  -- chunks_read, so honouring the parameter cannot expose anything to it.
  if auth.uid() is null or public.is_editor() then
    effective_scopes := allowed_coa_scopes;
  else
    effective_scopes := array['purity'];
  end if;

  return query
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
    c.retired_at is null
    and (source_kinds is null or s.kind = any(source_kinds))
    and s.valid_until is null
    and (
      effective_scopes is null
      or s.kind <> 'coa'
      or exists (
        select 1
        from public.coas co
        where s.path ~ '^coa:[0-9a-fA-F-]{36}$'
          and co.id = substring(s.path from 5)::uuid
          and co.product_scope = any(effective_scopes)
      )
    )
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;
