// Per-user rate limiter backed by public.rate_limits + RPC.
// Caller must supply an authenticated Supabase client. The RPC reads
// auth.uid() server-side, so we cannot call this with the service-role client.

import type { SupabaseClient } from '@supabase/supabase-js';

export type RateLimitResult = {
  allowed: boolean;
  reason?: 'rpm_exceeded' | 'rpd_exceeded';
  rpm_remaining: number;
  rpd_remaining: number;
  retry_after_seconds: number;
};

const CHAT_RPM_LIMIT = Number(process.env.CHAT_RPM_LIMIT ?? 30);
const CHAT_RPD_LIMIT = Number(process.env.CHAT_RPD_LIMIT ?? 500);

export async function checkChatRateLimit(supabase: SupabaseClient): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc('check_and_increment_rate_limit', {
    p_bucket_key: 'chat',
    p_limit_rpm: CHAT_RPM_LIMIT,
    p_limit_rpd: CHAT_RPD_LIMIT,
  });
  if (error || !data) {
    // Fail-open on DB error so a monitoring issue doesn't take chat offline,
    // but log. If rate limiting is security-critical this policy flips.
    console.error('[rate-limit] rpc failed, failing open:', error);
    return { allowed: true, rpm_remaining: -1, rpd_remaining: -1, retry_after_seconds: 0 };
  }
  return data as RateLimitResult;
}
