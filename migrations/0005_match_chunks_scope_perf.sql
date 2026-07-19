-- 0005_match_chunks_scope_perf
--
-- URGENT FIX for a regression introduced by 0003.
--
-- 0003 added `left join public.coas co on s.kind='coa' and s.path = 'coa:'||co.id::text`.
-- That join predicate builds a string on the `coas` side, so no index on
-- either table can serve it: the planner nested-loops over `coas` for every
-- candidate chunk. It measured fine on a warmed direct connection and timed
-- out through PostgREST, which is the path the application actually uses:
--
--   ORIGINAL body via PostgREST : OK, 8 rows, 1399 ms
--   0003 body    via PostgREST : canceling statement due to statement timeout
--
-- `authenticated` carries statement_timeout=8s, so this took chat down for
-- every non-service-role caller.
--
-- Two changes:
--
-- 1. Replace the LEFT JOIN with a correlated EXISTS. When
--    `allowed_coa_scopes is null` — editors, admins, and every ingestion job —
--    the clause short-circuits before the subquery is ever planned, so the
--    unrestricted path is byte-for-byte the pre-0003 query shape.
--
-- 2. Compare on `co.id` (the primary key) by casting the extracted text to
--    uuid, instead of casting the key to text. That makes it a PK index
--    lookup. The path is regex-guarded first so a malformed value can never
--    raise an invalid-uuid cast error mid-query.
--
-- Semantics are unchanged from 0003: non-COA chunks are unaffected, and a
-- COA-kind source whose path does not resolve to a live `coas` row is excluded
-- when a restriction is supplied.

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
    and (
      allowed_coa_scopes is null
      or s.kind <> 'coa'
      or exists (
        select 1
        from public.coas co
        where s.path ~ '^coa:[0-9a-fA-F-]{36}$'
          and co.id = substring(s.path from 5)::uuid
          and co.product_scope = any(allowed_coa_scopes)
      )
    )
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

comment on function public.match_chunks is
  'Vector search over chunks. allowed_coa_scopes restricts COA-derived chunks '
  'by coas.product_scope: null = unrestricted (editors/admins/jobs), '
  'ARRAY[''purity''] = customer-service allowlist. Implemented as a correlated '
  'EXISTS with a primary-key lookup so the unrestricted path plans identically '
  'to the pre-0003 query. See AUDIT-FIXES-LOG.md session 4 task 1 / task 6.';
