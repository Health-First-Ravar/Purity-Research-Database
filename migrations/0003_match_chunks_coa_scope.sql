-- 0003_match_chunks_coa_scope
--
-- Scope COA-derived chunks by `coas.product_scope` inside the retrieval RPC.
--
-- /api/chat is reachable by customer_service and quotes retrieved chunk text
-- back to customers. COA chunks carry a bare sample code as their title, so a
-- chunk sourced from a lot we have not identified — or from a third-party
-- product — reads exactly like one of ours. The `coas` allowlist added in 0002
-- does nothing here, because retrieval reads `chunks`/`sources` and never
-- touches `coas`.
--
-- The filter belongs in the RPC rather than in the caller: a post-fetch filter
-- would still have pulled the restricted text into the application, and would
-- have to be re-applied correctly by every future caller of match_chunks.
--
-- `allowed_coa_scopes`:
--   null            -> no COA restriction (audit team, editors, ingestion jobs)
--   ARRAY['purity'] -> only COAs for products we sell (customer service)
--
-- Chunks that are not COA-derived are unaffected in either case. A COA-kind
-- source whose `path` does not resolve to a live `coas` row is EXCLUDED when a
-- restriction is supplied — an unresolvable provenance cannot be shown to fail
-- closed any other way.

-- Drop the 4-arg signature first. Adding a defaulted 5th parameter would
-- otherwise create an overload rather than a replacement, leaving two
-- definitions that can drift. The prior definition lives in 0001_initial.sql.
drop function if exists public.match_chunks(vector(1024), int, text[], float);

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
  left join public.coas co
    on s.kind = 'coa' and s.path = 'coa:' || co.id::text
  where
    (source_kinds is null or s.kind = any(source_kinds))
    and s.valid_until is null
    and (
      allowed_coa_scopes is null
      or s.kind <> 'coa'
      or (co.id is not null and co.product_scope = any(allowed_coa_scopes))
    )
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

comment on function public.match_chunks is
  'Vector search over chunks. allowed_coa_scopes restricts COA-derived chunks '
  'by coas.product_scope: null = unrestricted (editors/admins/jobs), '
  'ARRAY[''purity''] = customer-service allowlist. Non-COA chunks are never '
  'affected. See AUDIT-FIXES-LOG.md session 4 task 1.';
