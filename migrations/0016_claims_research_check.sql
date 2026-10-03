-- Research Hub, Claims area: link claim checks to Brian's claim library.
--
-- Additive only. lab_claims.research_verdict already exists (0014); this adds
-- which audit produced it and when, and lets a claim_audits row point at the
-- library claim it checked. Brian's own claim fields are untouched, and the
-- importer upserts only his fields, so these survive every sync.

alter table public.lab_claims
  add column if not exists research_audit_id   uuid,
  add column if not exists research_checked_at timestamptz;

alter table public.claim_audits
  add column if not exists lab_claim_id text,
  add column if not exists verdict      text;

create index if not exists claim_audits_lab_claim_idx on public.claim_audits (lab_claim_id);
