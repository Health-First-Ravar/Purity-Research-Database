-- 0006_enforce_coa_scope_in_rls
--
-- Move the customer-service allowlist from the application into the database.
--
-- Until now the allowlist lived only in the page queries. RLS on `coas` was
-- `auth.role() = 'authenticated'`, so ANY signed-in user could read every row —
-- competitors included — straight from PostgREST using the public anon key and
-- their own session token. Verified: a customer_service JWT returned all 266
-- rows and all 6 competitor rows, bypassing every filter we added.
--
-- Likewise `match_chunks` took `allowed_coa_scopes` from the caller and trusted
-- it. A non-editor could pass null and retrieve every COA chunk, including
-- third-party lab text, defeating the retrieval scoping added in 0003/0005.
--
-- Neither is an exotic attack: the anon key ships in the client bundle by
-- design and the JWT is in the user's own browser. A control that a rep can
-- step around by opening devtools is not a control.
--
-- Two changes, both server-side:
--
--   1. `coas` SELECT policy is scoped by role. Editors and admins see
--      everything; everyone else sees live `purity` rows only.
--   2. `match_chunks` computes the effective scope itself. The parameter can
--      now only NARROW for a non-editor, never widen.
--
-- service_role continues to bypass RLS, so ingestion and the admin scripts are
-- unaffected.

-- ---------------------------------------------------------------------------
-- 1. Scoped read policy on coas
-- ---------------------------------------------------------------------------
drop policy if exists coas_read on public.coas;

create policy coas_read on public.coas
  for select
  using (
    -- Keep the signed-in requirement: without it the clause below would expose
    -- purity rows to the anon role.
    auth.role() = 'authenticated'
    and (
      public.is_editor()
      or (product_scope = 'purity' and retired_at is null)
    )
  );

comment on policy coas_read on public.coas is
  'Editors/admins read all COAs including competitor and unclassified rows '
  '(benchmarking and audit). Everyone else reads live purity rows only. '
  'Enforced here rather than only in page queries because the anon key is '
  'public and a session JWT is client-side. See AUDIT-FIXES-LOG.md session 5 '
  'task 4.';

-- ---------------------------------------------------------------------------
-- 2. match_chunks decides the scope, rather than trusting its caller
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
  -- auth.uid() is null for service_role (ingestion, admin scripts) and for the
  -- anon role. service_role bypasses RLS and is trusted; anon is already
  -- blocked from `chunks` by chunks_read, so honouring the parameter here
  -- cannot expose anything to it.
  if auth.uid() is null or public.is_editor() then
    effective_scopes := allowed_coa_scopes;
  else
    -- Non-editor. The caller's value is advisory and may only narrow.
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

comment on function public.match_chunks is
  'Vector search over chunks. The effective COA scope is decided inside the '
  'function: editors/admins and service_role get the caller''s value, everyone '
  'else is forced to purity regardless of what was passed. The parameter can '
  'only narrow for a non-editor. See AUDIT-FIXES-LOG.md session 5 task 4.';
