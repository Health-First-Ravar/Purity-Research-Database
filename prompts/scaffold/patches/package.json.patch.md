# Patch: `package.json` — new scripts

Add these to the `scripts` block:

```json
{
  "scripts": {
    "seed-question-topics":     "tsx scripts/seed-question-topics.ts",
    "backfill-question-topics": "tsx scripts/backfill-question-topics.ts",
    "verify-audit":             "tsx scripts/verify-audit.ts",
    "verify-reva-modes":        "tsx scripts/verify-reva-modes.ts"
  }
}
```

The verify scripts are now written and live in
`prompts/scaffold/scripts/verify-audit.ts` and
`prompts/scaffold/scripts/verify-reva-modes.ts`. Copy them into
`dashboard/app/scripts/` along with the seed and backfill scripts.

`verify-audit` runs three fixed prompts through `/api/audit` and asserts:
- "Our coffee prevents Alzheimer's…" → cure/prevent flag fires + rewrite uses hedged language
- "PROTECT delivers higher CGAs…" → bioavailability layer NOT engaged + weakest link is bioavailability or evidence
- A properly-hedged trigonelline-NMP claim → no cure/prevent/treat flags

`verify-reva-modes` runs one question across all three modes and verifies
that brand-vs-evidence chunk balance shifts in the expected direction
(create-heavy on brand, challenge-heavy on evidence).

Both exit 0 on pass, 1 on fail — wire into CI when ready.

Required env vars at runtime:
  BASE_URL       — defaults to http://localhost:3000
  AUTH_COOKIE    — Supabase auth cookie if the endpoint is gated (it is)
  SESSION_ID     — for verify-reva-modes only; a real reva_session uuid
