# Row-Level Security — Access matrix

Two roles in `profiles.role`: **`user`** (default for everyone with a Purity email) and **`editor`** (Jeremy + Ildi, explicitly promoted). Helper: `public.is_editor()` reads the current session's profile.

Customer-service and research staff both sit under `user` today. If the access needs diverge, split `user` into `customer_service` and `researcher` in migration 0007 and update the policies below.

## Matrix

| Table / View              | user — SELECT            | user — INSERT | user — UPDATE                                | user — DELETE | editor           |
|---------------------------|--------------------------|---------------|----------------------------------------------|---------------|------------------|
| `profiles`                | self only                | self (via auth trigger) | self only                          | —             | full             |
| `sources`                 | all active rows          | —             | —                                            | —             | full             |
| `chunks`                  | all                      | —             | —                                            | —             | full             |
| `canon_qa`                | `status='active'` only   | —             | —                                            | —             | full             |
| `messages`                | own rows                 | any auth'd    | own row, only `user_rating*` columns (trigger-enforced) | — | full |
| `reviews`                 | all                      | —             | —                                            | —             | full             |
| `update_jobs`             | —                        | —             | —                                            | —             | full             |
| `coas`                    | all                      | —             | —                                            | —             | full             |
| `rate_limits`             | own rows (debug)         | —             | —                                            | —             | full (audit)     |
| `escalation_events`       | —                        | —             | —                                            | —             | full             |
| `bibliography_view`       | all                      | —             | —                                            | —             | —                |
| `daily_chat_metrics` (view) | via RLS of `messages`  | —             | —                                            | —             | effectively full via own-row access; use /api/metrics for editor-scoped rollups |
| `promotion_candidates` (view) | via RLS              | —             | —                                            | —             | effectively full |
| `canon_misses` (view)     | via RLS                  | —             | —                                            | —             | effectively full |
| `escalation_queue_view`   | via RLS of `messages`    | —             | —                                            | —             | full             |

## Notes

- Views inherit the RLS of their base tables. `daily_chat_metrics` is a rollup over `messages`; a user can only see aggregates of their own turns. Use `/api/metrics` (editor-gated) for the real dashboard numbers.
- The `messages_restrict_user_update` trigger (migration 0004) prevents a non-editor from bypassing RLS via the REST API to set `editor_label`, `escalated`, `canon_hit_id`, etc. on their own row. It only allows `user_rating`, `user_rating_note`, `user_rated_at`.
- `canon_qa` drafts and deprecated rows are hidden from `user` — only `active` shows. The LLM retrieval path uses `match_canon` RPC which also filters to `status='active'`, so users never see drafts in chat.
- `sources` visibility is "all active rows" — we're not segmenting by classification yet. If some sources become sensitive (e.g., unpublished Purity internal memos), add a `sources.visibility` column and amend the read policy.
- `reviews` are readable by all authenticated users. Rethink if Amazon reviews carry author handles that shouldn't be broadcast.

## Verification

Run `npm run verify-rls` to execute a live probe: the script signs in as a test `user` and a test `editor`, then attempts every CRUD operation on every table, asserting the expected 200/403/404/409. Fails loudly on any discrepancy.

Required env vars for the script:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_TEST_USER_EMAIL=...
SUPABASE_TEST_USER_PASSWORD=...
SUPABASE_TEST_EDITOR_EMAIL=...
SUPABASE_TEST_EDITOR_PASSWORD=...
```
