-- Bibliography expansion: fold in Jeremy's 448-article catalog.
-- Adds first-class columns for DOI + topic organization + rights flags so the
-- Bibliography page can filter and badge without digging into metadata jsonb.

alter table public.sources
  add column if not exists doi                text,
  add column if not exists year_published     int,
  add column if not exists topic_category     text,   -- fine-grained: "Diabetes / Systematic Review"
  add column if not exists drive_location     text,   -- high-level: "Type II Diabetes", "Cancer", etc.
  add column if not exists rights_share       text,   -- "Yes" | "Yes - CC BY" | "No" | "Limited" | "Partial"
  add column if not exists rights_download    text,   -- "Yes - Open Access" | "Yes - Free via PMC" | "No - Subscription" ...
  add column if not exists database_platform  text,   -- "PubMed / JAMA", etc.
  add column if not exists has_pdf            boolean not null default false;

create unique index if not exists sources_doi_uniq
  on public.sources(doi)
  where doi is not null and valid_until is null;

create index if not exists sources_topic_category_idx on public.sources(topic_category);
create index if not exists sources_drive_location_idx on public.sources(drive_location);
create index if not exists sources_year_idx           on public.sources(year_published);
create index if not exists sources_rights_download_idx on public.sources(rights_download);

-- Convenience view: the bibliography row shape the UI wants.
create or replace view public.bibliography_view as
  select
    id,
    title,
    doi,
    year_published,
    topic_category,
    drive_location,
    rights_share,
    rights_download,
    database_platform,
    has_pdf,
    drive_url,
    kind,
    created_at
  from public.sources
  where kind in ('research_paper','coffee_book')
    and valid_until is null;

grant select on public.bibliography_view to authenticated;
