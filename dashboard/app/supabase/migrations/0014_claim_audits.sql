-- 0007: Claim Audits — the Bioavailability Gap Detector store.
--
-- Captures every audit Reva runs against a draft sentence/paragraph: which
-- compounds were detected, which of the four Compound Reasoning Stack layers
-- the draft engaged (mechanism / bioavailability / evidence / practical), the
-- weakest link, regulatory flags, evidence tier (1..7 from the Reva skill's
-- Evidence Hierarchy), and Reva's reconstructed-claim rewrite.
--
-- Design notes:
--   * audit_json holds the full raw structured output from Sonnet so we can
--     replay or re-derive features later without another model call.
--   * We don't allow user-side updates — audits are immutable once written.
--     Editors can still update for triage/cleanup.

begin;

create table if not exists public.claim_audits (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid references public.profiles(id),
  draft_text               text not null,
  context                  text,                         -- 'newsletter' | 'module' | 'chat_answer' | 'product_page' | 'other'
  compounds_detected       text[] not null default '{}',
  mechanism_engaged        boolean not null default false,
  bioavailability_engaged  boolean not null default false,
  evidence_engaged         boolean not null default false,
  practical_engaged        boolean not null default false,
  weakest_link             text check (weakest_link in ('mechanism','bioavailability','evidence','practical')),
  regulatory_flags         text[] not null default '{}', -- e.g. 'cure_word','prevent_word','treat_word','cures_disease','overstated_effect','single_roast_overclaim'
  evidence_tier            int check (evidence_tier between 1 and 7),
  suggested_rewrite        text,
  cited_chunk_ids          uuid[] not null default '{}',
  audit_json               jsonb not null default '{}'::jsonb,
  model                    text not null default 'sonnet',
  tokens_in                int,
  tokens_out               int,
  cost_usd                 numeric(10,6),
  latency_ms               int,
  created_at               timestamptz not null default now()
);

create index if not exists claim_audits_user_idx       on public.claim_audits(user_id, created_at desc);
create index if not exists claim_audits_compounds_idx  on public.claim_audits using gin(compounds_detected);
create index if not exists claim_audits_flags_idx      on public.claim_audits using gin(regulatory_flags);
create index if not exists claim_audits_weakest_idx    on public.claim_audits(weakest_link);

alter table public.claim_audits enable row level security;

create policy claim_audits_self_read on public.claim_audits
  for select using (user_id = auth.uid() or public.is_editor());

create policy claim_audits_self_insert on public.claim_audits
  for insert with check (auth.role() = 'authenticated');

-- Editors get full update/delete; users cannot modify audits after insert.
create policy claim_audits_editor_all on public.claim_audits
  for all using (public.is_editor()) with check (public.is_editor());

comment on table public.claim_audits is
  'Bioavailability Gap Detector: structured audit of a draft against the Compound Reasoning Stack.';

commit;
