-- 0007_scope_sources_chunks_rls
--
-- Close the last direct-read leak: `chunks` and `sources` were readable in full
-- by any authenticated user, so a customer-service session could pull COA text
-- — competitor lab results included — straight from PostgREST, bypassing both
-- the coas allowlist (0006) and the retrieval scoping (0003/0005). Verified: a
-- CS JWT returned 200 COA chunks directly.
--
-- Scope is applied on `sources` only. `chunks` then requires its source to be
-- visible, and because RLS applies inside a policy's own subqueries, the
-- sources policy composes automatically — one place to maintain rather than the
-- same predicate duplicated across two tables.
--
-- The sources predicate references `coas`, whose 0006 policy is also applied
-- inside it, so for a non-editor the EXISTS can only ever see live purity rows.
-- That is deliberate: the visibility rule is expressed once, on coas.
--
-- PERFORMANCE: measured through PostgREST as `authenticated` before and after,
-- at production parameters, because this sits directly in the retrieval path.
-- Numbers are in AUDIT-FIXES-LOG.md session 5 task 4. If a future change to
-- these policies regresses retrieval, revert rather than raising the timeout.

-- ---------------------------------------------------------------------------
-- sources: non-editors see non-COA sources, plus COA sources for live purity
-- ---------------------------------------------------------------------------
drop policy if exists sources_read on public.sources;

create policy sources_read on public.sources
  for select
  using (
    auth.role() = 'authenticated'
    and (
      public.is_editor()
      or kind <> 'coa'
      or exists (
        select 1
        from public.coas co
        where public.sources.path ~ '^coa:[0-9a-fA-F-]{36}$'
          and co.id = substring(public.sources.path from 5)::uuid
      )
    )
  );

comment on policy sources_read on public.sources is
  'Editors read all sources. Non-editors read non-COA sources plus COA sources '
  'whose coas row is visible to them — which the coas policy already limits to '
  'live purity rows. See AUDIT-FIXES-LOG.md session 5 task 4.';

-- ---------------------------------------------------------------------------
-- chunks: visible only when the parent source is visible
-- ---------------------------------------------------------------------------
drop policy if exists chunks_read on public.chunks;

create policy chunks_read on public.chunks
  for select
  using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.sources s where s.id = public.chunks.source_id
    )
  );

comment on policy chunks_read on public.chunks is
  'A chunk is readable when its source is. The scope rule lives on sources '
  '(and ultimately on coas) rather than being restated here.';
