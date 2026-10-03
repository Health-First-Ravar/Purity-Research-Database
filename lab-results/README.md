# lab-results

`snapshot.json` is a read-only copy of Brian's Lab Testing tracker (a Claude artifact):
every lab record, his claims library, and the Health Grade limits his tracker scores against.
Nothing here writes back to his tracker.

## Daily sync (current: Mac-bound)

A Claude scheduled task in the Purity Coffee organization ("Purity lab sync") runs on
weekdays at 9:46 AM and 2:46 PM ET on Jeremy's Mac. It reads the tracker page and database,
builds the snapshot with `build-snapshot.mjs`, writes it to `lab-results/latest/snapshot.json`
(not committed) and imports it with `bash lab-results/import-local.sh`, using
`dashboard/app/.env.local`. It skips the import when nothing changed, and skips the run if the
Mac is asleep. It runs from the working copy, so the branch with these scripts must be checked
out.

## Daily sync (cloud, once GitHub is enabled for the Purity Coffee organization)

1. A Claude scheduled task reads his tracker page (Artifact read) and his artifact database
   (`seed`, `results`, `claimseed`, `claims`, `config/standard`) with ArtifactData.
2. It runs `bash lab-results/sync.sh <page.html> <dump-dir>`, which builds the snapshot with
   `build-snapshot.mjs` on the `lab-snapshots` branch and pushes only when the data changed.
3. The push runs `.github/workflows/lab-sync.yml`, which imports it with
   `dashboard/app/scripts/import-lab-results.ts` into `lab_results`, `lab_standard` and
   `lab_claims`; each run is logged in `sync_runs`.

The branch's history shows what changed day to day:
`git log -p origin/lab-snapshots -- lab-results/snapshot.json`. The copy on the working
branch is the reference snapshot from the last manual import.

The standard and the reclassification table (COMP_OV) still live in his page code, so the
builder reads them from the page. Until Brian's tracker stores computed statuses, the Hub
applies his rules through `dashboard/app/lib/lab-status.ts` (checked for parity against his
page code).

## Manual run

    node lab-results/build-snapshot.mjs --page page.html --db dump/ --out lab-results/snapshot.json
    cd dashboard/app && node --env-file=.env.local ./node_modules/.bin/tsx scripts/import-lab-results.ts
