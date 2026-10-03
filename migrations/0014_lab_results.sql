-- 0014_lab_results
--
-- Research Hub overhaul, phase 4: COA data sourced from Brian's Lab Testing
-- tracker (a Claude artifact). A snapshot of his records is written to
-- lab-results/snapshot.json and imported by scripts/import-lab-results.ts.
--
-- Additive only. coas, coa_limits and the Drive importer are untouched and keep
-- serving today's pages until the overhaul switches over.
--
-- Interim (until Brian's tracker stores them itself):
--   * computed_status is produced by lib/lab-status.ts, a port of his rules.
--   * lab_standard is copied from his tracker's analyte table and Green Arabica
--     Requirements v2.5.

-- ---------------------------------------------------------------------------
-- Results: one row per record in Brian's tracker
-- ---------------------------------------------------------------------------
create table if not exists public.lab_results (
  id               text primary key,               -- Brian's record id, e.g. t0306
  kind             text not null
                   check (kind in ('product','green','rd','roasted-other','competitor')),
  product          text,                           -- FLOW, EASE, ... null for green / R&D
  name             text,
  description      text,
  lab              text,
  sample_type      text,                           -- green | roasted | brewed | unknown
  test_date        date,                           -- Brian's date (decision 2026-10-03)
  status           text,                           -- Final | Partial | Awaiting sample
  order_number     text,
  sample_number    text,
  report_number    text,
  source           text,                           -- where Brian found it (Eurofins portal, email, ...)
  analytes         jsonb not null default '{}'::jsonb,  -- { CODE: [ {v, q, raw, rt?} ] }
  computed_status  text,                           -- worst analyte status, Brian's rules (interim)
  certificate_url  text,                           -- existing Drive link matched via coas/sources
  snapshot_id      text not null,
  synced_at        timestamptz not null default now()
);

create index if not exists lab_results_product_date_idx on public.lab_results (product, test_date desc);
create index if not exists lab_results_kind_idx on public.lab_results (kind);
create index if not exists lab_results_sample_idx on public.lab_results (sample_number);

comment on table public.lab_results is
  'COA results mirrored read-only from Brian''s Lab Testing tracker. Source of record is his tracker; '
  'never edit rows here, re-import a snapshot instead.';

-- ---------------------------------------------------------------------------
-- Standard: the limits each result is scored against
-- ---------------------------------------------------------------------------
create table if not exists public.lab_standard (
  code        text not null,                       -- Brian's analyte code: Pb, OTA, ACR, CGA ...
  applies_to  text not null check (applies_to in ('finished','green')),
  label       text not null,
  unit        text not null default '',
  grp         text,                                -- Heavy metals, Mycotoxins, ...
  rule        text not null
              check (rule in ('ceiling','floor','not_detectable','flag_detected','informational')),
  value       numeric,
  required    boolean not null default true,
  roasted_only boolean not null default false,
  version     text not null,
  primary key (code, applies_to)
);

-- ---------------------------------------------------------------------------
-- Claims: Brian's claims library, imported once and owned here afterwards
-- ---------------------------------------------------------------------------
create table if not exists public.lab_claims (
  id                text primary key,              -- Brian's claim id, e.g. c001
  claim             text not null,
  category          text,
  channel           text,
  source_group      text,
  risk              text,
  products          text[] not null default '{}',
  occurrences       int not null default 1,
  evidence_needed   text,
  evidence_type     text,
  notes             text,
  locations         jsonb not null default '[]'::jsonb,
  research_verdict  text,                          -- set by the Hub's claim checker
  review_status     text,                          -- off until Brian agrees (decision 2026-10-03)
  snapshot_id       text not null,
  synced_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sync log
-- ---------------------------------------------------------------------------
create table if not exists public.sync_runs (
  id           bigserial primary key,
  source       text not null default 'brian-lab-tracker',
  snapshot_id  text not null,
  taken_at     timestamptz,
  imported_at  timestamptz not null default now(),
  records      int,
  claims       int,
  status       text not null check (status in ('ok','rejected','failed')),
  detail       jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Latest result per finished product and analyte
-- ---------------------------------------------------------------------------
create or replace view public.lab_latest
with (security_invoker = on) as
select distinct on (r.product, a.key)
  r.product,
  a.key            as code,
  a.value          as values,
  r.id             as result_id,
  r.test_date,
  r.lab,
  r.certificate_url
from public.lab_results r
cross join lateral jsonb_each(r.analytes) as a(key, value)
where r.kind = 'product'
  and r.product is not null
  and coalesce(r.status, '') <> 'Awaiting sample'
order by r.product, a.key, r.test_date desc nulls last, r.id desc;

-- ---------------------------------------------------------------------------
-- RLS: customer service sees finished products only; staff see everything.
-- Writes go through the service role (importer) only.
-- ---------------------------------------------------------------------------
alter table public.lab_results  enable row level security;
alter table public.lab_standard enable row level security;
alter table public.lab_claims   enable row level security;
alter table public.sync_runs    enable row level security;

drop policy if exists lab_results_read on public.lab_results;
create policy lab_results_read on public.lab_results
  for select using (
    auth.role() = 'authenticated'
    and (public.is_editor() or kind = 'product')
  );

drop policy if exists lab_standard_read on public.lab_standard;
create policy lab_standard_read on public.lab_standard
  for select using (auth.role() = 'authenticated');

drop policy if exists lab_claims_read on public.lab_claims;
create policy lab_claims_read on public.lab_claims
  for select using (auth.role() = 'authenticated');

drop policy if exists sync_runs_read on public.sync_runs;
create policy sync_runs_read on public.sync_runs
  for select using (public.is_editor());

grant select on public.lab_results, public.lab_standard, public.lab_claims, public.sync_runs, public.lab_latest to authenticated;
