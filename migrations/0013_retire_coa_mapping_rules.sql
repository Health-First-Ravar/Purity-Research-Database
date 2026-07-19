-- 0013_retire_coa_mapping_rules
--
-- Retires the COA origin/region mapping-rules feature. The UI
-- (/reports/mappings) and its API routes are removed in the same commit.
--
-- WHY
--
-- The feature was a closed loop: `coa_mapping_rules` was referenced only by its
-- own CRUD UI and API. Nothing in scripts/ or lib/ ever read it. `import-coas`
-- derives origin independently via extractOrigin(sample_name) and never set
-- region at all. The table held 0 rows, so the "Apply rules to all COAs" button
-- was permanently disabled.
--
-- It should not simply be wired up, because `apply_coa_mapping_rules()` is an
-- unbounded UPDATE with no dry run, no audit row and no revert — and its
--
--     set origin = coalesce(m.new_origin, c.origin)
--
-- means a rule silently overwrites an origin an editor typed by hand on
-- /reports/[id], which is currently the ONLY mechanism actually populating
-- these fields. The careful path loses to the bulk path with no record that it
-- happened. On provenance for regulated lab results that is the wrong direction
-- to fail.
--
-- /reports/assign already does this class of work correctly: dry run by default,
-- every change logged to coa_assignment_log with previous values, exact revert.
--
-- WHAT THIS DOES AND DOES NOT DO
--
-- Drops the function — its full definition is preserved in
-- migrations/0008_coa_mapping_rules.sql, so restoring it is a copy-paste.
--
-- Does NOT drop the table. Per the standing no-DELETE rule, it is soft-retired:
-- privileges revoked so nothing can read or write it, RLS and structure left
-- intact, and the reason recorded in a comment. The table currently holds 0
-- rows, so nothing is lost either way, but a dropped table cannot be inspected
-- later to answer "what was this for?" while a retired one can.

-- The only caller was POST /api/reports/mappings/apply, removed in this commit.
drop function if exists public.apply_coa_mapping_rules();

-- Soft-retire the table: inert, but recoverable.
revoke all on public.coa_mapping_rules from authenticated;
revoke all on public.coa_mapping_rules from anon;

comment on table public.coa_mapping_rules is
  'RETIRED 2026-07-19 (migration 0013). Pattern-based origin/region assignment '
  'for COAs. Never used in production: 0 rows, and no consumer outside its own '
  'CRUD UI, which is removed. Retired rather than dropped so the design stays '
  'inspectable. Privileges revoked — the table is inert. Do not re-enable '
  'without adding the dry-run, audit-log and revert guarantees that '
  '/reports/assign has; the old apply_coa_mapping_rules() overwrote '
  'hand-entered origins with no audit trail. Definition of the dropped function '
  'is in migrations/0008_coa_mapping_rules.sql.';
