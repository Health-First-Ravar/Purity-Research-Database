// Supabase clients: browser, server (cookie-scoped), and service-role admin.
// Keep the service-role client behind server-only routes — never import client-side.

import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { CookieOptions } from '@supabase/ssr';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function supabaseBrowser() {
  return createBrowserClient(URL, ANON);
}

// Server Components / Route Handlers — wraps Next cookies() store.
export function supabaseServer(cookieStore: {
  get: (name: string) => { value: string } | undefined;
  set?: (name: string, value: string, options?: CookieOptions) => void;
  remove?: (name: string, options?: CookieOptions) => void;
}) {
  return createServerClient(URL, ANON, {
    cookies: {
      get(name: string)                                     { return cookieStore.get(name)?.value; },
      set(name: string, value: string, o?: CookieOptions)  { cookieStore.set?.(name, value, o); },
      remove(name: string, o?: CookieOptions)              { cookieStore.remove?.(name, o); },
    },
  });
}

// Service-role client — bypasses RLS. Only use in trusted server code
// (cron routes, ingestion scripts, admin actions).
export function supabaseAdmin() {
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
