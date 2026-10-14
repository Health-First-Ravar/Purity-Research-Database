-- 0018: views that bypassed row-level security, and signed-out reads.
--
-- APPLIED 2026-10-13 by Jeremy (SQL Editor). Found 2026-10-13 with the public anon key alone (no
-- sign-in), which ships in the site's JavaScript. Postgres views run with
-- their owner's rights unless told otherwise, so these read past the base
-- tables' RLS:
--
--   escalation_queue_view    25 rows: questions, answers, editor e-mails
--   canon_misses             29 rows: questions, answers, user ids
--   daily_chat_metrics       13 rows: usage and cost by day
--   question_heatmap         44 rows: topic counts
--   bibliography_view     1,465 rows: the research catalog with Drive links
--   promotion_candidates      0 rows today, same flaw
--
-- lab_latest (0014) already runs with the caller's rights. Tables were fine:
-- every one returned 0 rows signed out, except chunks, whose RLS check made a
-- signed-out select run until the statement timeout.
--
-- Fix:
--   A. Each view runs with the caller's rights (security_invoker), so the base
--      tables' RLS decides. The app reads these views only from staff pages
--      (metrics, heatmap, canon) and bibliography_view from the library and
--      Ask; staff read all messages under RLS, and every signed-in role reads
--      research sources, so nothing changes for signed-in users.
--   B. Signed-out requests (role anon) lose SELECT on public tables and views.
--      The app never reads data signed out; sign-in, reset and invites go
--      through the Auth API, not these tables.
--
-- Additive in effect: no data or columns change. To undo A, set
-- security_invoker = off on a view; to undo B, grant select back to anon.
-- Postgres 15+ (Supabase default).

begin;

-- A. Caller's rights for every view in public.
alter view public.escalation_queue_view set (security_invoker = on);
alter view public.canon_misses          set (security_invoker = on);
alter view public.daily_chat_metrics    set (security_invoker = on);
alter view public.question_heatmap      set (security_invoker = on);
alter view public.bibliography_view     set (security_invoker = on);
alter view public.promotion_candidates  set (security_invoker = on);

-- B. Nothing readable signed out.
revoke select on all tables in schema public from anon;

commit;

-- Check afterwards (signed out, anon key): each of the six views returns 0
-- rows or 401, and /library, /heatmap, /metrics and Canon answers still load
-- for an admin.
