-- 0005: Rate limiting for /api/chat (and any future LLM-backed route).
--
-- Design: sliding-window counter with minute granularity. Cheap to read,
-- cheap to write, idempotent under concurrent requests via ON CONFLICT.
--
-- Per-user per-minute cap (CHAT_RPM_LIMIT, default 30) and a per-user
-- per-day cap (CHAT_DPM_LIMIT, default 500) together bound cost.
--
-- A single RPC, check_and_increment_rate_limit(user_id, bucket_key, limit_rpm,
-- limit_rpd), does both checks in one round-trip.

begin;

create table if not exists public.rate_limits (
  user_id      uuid not null references auth.users(id) on delete cascade,
  bucket_key   text not null,                           -- e.g. 'chat', future 'embed'
  window_start timestamptz not null,                    -- truncated to the minute
  count        int not null default 0,
  primary key (user_id, bucket_key, window_start)
);

create index if not exists rate_limits_window_idx
  on public.rate_limits(window_start desc);

-- Retention: keep 48h. Older rows are cleanable via a cron job (keeps the
-- table small and the index tight). Idempotent to call.
create or replace function public.prune_rate_limits()
returns void
language sql security definer set search_path = public
as $$
  delete from public.rate_limits
  where window_start < now() - interval '48 hours';
$$;

-- RLS: users can read their own rows (for debugging), nobody writes directly.
alter table public.rate_limits enable row level security;

create policy rate_limits_self_read on public.rate_limits
  for select using (user_id = auth.uid() or public.is_editor());

-- RPC: atomic check-and-increment.
-- Returns { allowed boolean, rpm_remaining int, rpd_remaining int,
--           retry_after_seconds int }. Called by the API route.
create or replace function public.check_and_increment_rate_limit(
  p_bucket_key text,
  p_limit_rpm int,
  p_limit_rpd int
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_minute  timestamptz := date_trunc('minute', now());
  v_minute_count int;
  v_day_count    int;
  v_seconds_until_next_min int;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Count requests in the current minute (before our increment).
  select coalesce(sum(count), 0)
    into v_minute_count
    from public.rate_limits
   where user_id = v_user_id
     and bucket_key = p_bucket_key
     and window_start = v_minute;

  -- Count requests in the last 24 hours.
  select coalesce(sum(count), 0)
    into v_day_count
    from public.rate_limits
   where user_id = v_user_id
     and bucket_key = p_bucket_key
     and window_start >= now() - interval '24 hours';

  if v_minute_count >= p_limit_rpm then
    v_seconds_until_next_min := ceil(extract(epoch from (v_minute + interval '1 minute' - now())))::int;
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rpm_exceeded',
      'rpm_remaining', 0,
      'rpd_remaining', greatest(p_limit_rpd - v_day_count, 0),
      'retry_after_seconds', v_seconds_until_next_min
    );
  end if;

  if v_day_count >= p_limit_rpd then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rpd_exceeded',
      'rpm_remaining', greatest(p_limit_rpm - v_minute_count, 0),
      'rpd_remaining', 0,
      'retry_after_seconds', 3600  -- client should back off an hour
    );
  end if;

  -- Increment atomically.
  insert into public.rate_limits (user_id, bucket_key, window_start, count)
       values (v_user_id, p_bucket_key, v_minute, 1)
  on conflict (user_id, bucket_key, window_start)
    do update set count = public.rate_limits.count + 1;

  return jsonb_build_object(
    'allowed', true,
    'rpm_remaining', p_limit_rpm - v_minute_count - 1,
    'rpd_remaining', p_limit_rpd - v_day_count - 1,
    'retry_after_seconds', 0
  );
end;
$$;

grant execute on function public.check_and_increment_rate_limit(text, int, int) to authenticated;
grant execute on function public.prune_rate_limits() to service_role;

commit;
