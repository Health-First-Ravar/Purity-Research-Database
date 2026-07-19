-- 0009_revert_chunk_retired_predicate
--
-- Reverts the `c.retired_at is null` predicate that 0008 added to
-- `match_chunks`. The COLUMN and the retirement stay; only the retrieval
-- predicate is removed.
--
-- WHY: measured through PostgREST as `authenticated`, five real embeddings,
-- production parameters (k=8, sim=0.55, health kinds):
--
--   editor            417 / 590 / 1817 ms   (min / med / max)   fine
--   customer_service  6934 / 8574 / 9168 ms                     TIMING OUT
--
-- Editor is unaffected; the customer-service path is not. CS evaluates the
-- 0007 RLS chain — chunks -> sources -> coas — for each candidate row, and the
-- extra filter changes the plan enough that the nested policy cost is paid on
-- far more rows. CS was 826 ms median before 0008.
--
-- The predicate buys nothing today: every chunk retired in 0008 belongs to a
-- source with `valid_until` set, and `match_chunks` already filters
-- `s.valid_until is null`. It was defensive against a FUTURE query that reads
-- `chunks` without joining `sources` — and that protection lives in the column
-- itself, which any such query can filter on. Paying an 8-second timeout on the
-- customer-facing path for redundant defence is the wrong trade.
--
-- If the predicate is ever wanted back, it needs an index strategy that keeps
-- the HNSW ordering usable under the CS policy chain, and must be re-timed as
-- `authenticated` before shipping — a direct pooler connection will not show
-- this.

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
    -- NOTE: deliberately no `c.retired_at is null` here. See the header.
    -- Retired chunks are excluded because their source carries valid_until.
    (source_kinds is null or s.kind = any(source_kinds))
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
