# Handoff — Supabase last mile (paused 2026-06-12)

## Status
- CODE: SHIPPED & LIVE. Vercel production = commit 62fa31a (Ready),
  purity-dashboard-three.vercel.app. Live: multi-select/multi-series analyte
  chart, Green/Roasted selector, /reports/support snapshot.
- DATA: NOT yet in Supabase. The 50 grid COAs + gap COA are in Processed/ and
  GitHub, but not imported into the coas table, and the matrix column does not
  exist there yet. Until the steps below run, Green/Roasted has nothing to filter.

## Key commits
- 7e448d4 grid parser + 50 research COAs + matrix migration + dashboard
- b81de10 cleanup (dupe scripts, stale slug)
- 86e0e69 merge of remote main (-X ours)
- 62fa31a fix recharts Tooltip formatter types (green build)

## Remaining — 4 steps
1. Supabase SQL editor: run scripts/sql/add-matrix-column.sql (adds matrix column).

2. Edit dashboard/app/scripts/import-coas.ts to carry matrix (two lines):
   - in `type ProcessedCOA`, add:        matrix?: string | null;
   - in the returned row (after the lab line), add:   matrix: doc.matrix ?? null,
   Verify: grep -n matrix dashboard/app/scripts/import-coas.ts  -> 2 lines.

3. Import (Supabase keys are in dashboard/app/.env.local):
   cd dashboard/app
   node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-coas.ts
   cd ../..
   Expect: [import-coas] done. inserted=... errors=0

4. Commit + push:
   git add dashboard/app/scripts/import-coas.ts
   git commit -m "import-coas: carry matrix into coas"
   git push

## Verify
- Open production /reports, toggle Green / Roasted -> rows filter.
- The 50 RESEARCH-* rows have product_key null, so blend is null; matrix drives
  green/roasted. Set product_key + re-import to promote any to a blend later.

## Gotchas
- Google Drive for Desktop intermittently times out file I/O; a Drive restart
  clears it. Files created via the Drive API do NOT reliably sync down to the Mac
  -- write repo files locally (heredoc) instead.
- More grid reports in the "Certificates of Analysis ALL TIME PURITY" archive
  (Nov 2022, Nov 2023, balance June 2024) -- same one-line ingest command.
- Bibliography still owes recent papers in that archive: Saraiva 2023,
  s12940-024-01098-8, s11947-024-03539-1, s11157-023-09669-w, s41598-021-85787-1,
  and the 995712 CGA lab set.
