-- COA mapping rules — pattern-based assignment of origin/region to coffees
-- by matching sample_name / coffee_name. Blend is intentionally excluded
-- (it's seasonal — assigned per-batch, not per-coffee).

alter table public.coas
  add column if not exists region text;

create index if not exists coas_origin_idx on public.coas(origin);
create index if not exists coas_region_idx on public.coas(region);

create table if not exists public.coa_mapping_rules (
  id            uuid primary key default gen_random_uuid(),
  pattern       text not null,
  pattern_type  text not null default 'contains'
                check (pattern_type in ('contains', 'regex')),
  origin        text,
  region        text,
  notes         text,
  priority      int  not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists coa_mapping_rules_priority_idx
  on public.coa_mapping_rules(priority);

alter table public.coa_mapping_rules enable row level security;

drop policy if exists "coa_mapping_rules read all" on public.coa_mapping_rules;
create policy "coa_mapping_rules read all"
  on public.coa_mapping_rules for select
  using (true);

drop policy if exists "coa_mapping_rules editor write" on public.coa_mapping_rules;
create policy "coa_mapping_rules editor write"
  on public.coa_mapping_rules for all
  using (public.is_editor())
  with check (public.is_editor());

-- Server-side rule application: evaluates every rule against every COA in
-- priority order (lowest first), first match wins per field. Returns updated
-- row count. Editor-only.
create or replace function public.apply_coa_mapping_rules()
returns table(updated_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if not public.is_editor() then
    raise exception 'editor role required';
  end if;

  with matched as (
    select distinct on (c.id)
      c.id,
      r.origin as new_origin,
      r.region as new_region
    from public.coas c
    left join public.coa_mapping_rules r on (
      (r.pattern_type = 'contains'
        and (c.coffee_name ilike '%' || r.pattern || '%'))
      or
      (r.pattern_type = 'regex'
        and (c.coffee_name ~* r.pattern))
    )
    where r.id is not null
    order by c.id, r.priority asc
  )
  update public.coas c
     set origin = coalesce(m.new_origin, c.origin),
         region = coalesce(m.new_region, c.region)
    from matched m
   where c.id = m.id;

  get diagnostics v_count = row_count;
  return query select v_count;
end;
$$;

grant execute on function public.apply_coa_mapping_rules() to authenticated;
