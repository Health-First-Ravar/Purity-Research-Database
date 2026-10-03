# lab-results

`snapshot.json` is a read-only copy of Brian's Lab Testing tracker (a Claude artifact):
every lab record, his claims library, and the Health Grade limits his tracker scores against.

- Written by a Claude task that reads his artifact database. Nothing writes back to his tracker.
- Imported with `scripts/import-lab-results.ts` (from `dashboard/app`) into `lab_results`,
  `lab_standard` and `lab_claims`; each run is logged in `sync_runs`.
- Each day's git diff shows exactly which results Brian added or changed.

Until Brian's tracker stores computed statuses and the standard itself, the Hub applies his
rules through `dashboard/app/lib/lab-status.ts` (checked for parity against his page code).
