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
