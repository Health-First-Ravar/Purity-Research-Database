#!/usr/bin/env tsx
// Seed (or refresh) the three role test accounts for the role-mode test plan.
//
// Creates admin / editor / customer_service users via the service-role Admin
// API, email-confirmed so they can sign in immediately, and sets each profile's
// role. Idempotent: re-running an existing account resets its password and role
// instead of failing.
//
// Usage (from dashboard/app):
//   npm run seed-test-users                          # random passwords, printed once
//   npm run seed-test-users -- --password 'MyPass1!' # one fixed password for all three
//   npm run seed-test-users -- --delete              # attempt teardown (see FK note)
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. In CI those are in
// the environment; locally this script loads them from .env.local itself.
//
// Teardown note: any test user that has used chat or Reva cannot be fully
// deleted until the FK-offboarding migration lands (nine columns reference
// profiles(id) with no ON DELETE). --delete reports which users it could not
// remove rather than pretending it worked.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient, type User } from '@supabase/supabase-js';

// --- env: use what's already set (CI), else fall back to .env.local ----------
function loadLocalEnv(): void {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    const txt = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* no .env.local; the guard below prints a clear error */
  }
}
loadLocalEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Run from dashboard/app so .env.local is found, or export the vars first.',
  );
  process.exit(1);
}

type Role = 'admin' | 'editor' | 'customer_service';

const ACCOUNTS: { email: string; role: Role }[] = [
  { email: process.env.TEST_ADMIN_EMAIL ?? 'admin-test@puritycoffee.com', role: 'admin' },
  { email: process.env.TEST_EDITOR_EMAIL ?? 'editor-test@puritycoffee.com', role: 'editor' },
  { email: process.env.TEST_CS_EMAIL ?? 'cs-test@puritycoffee.com', role: 'customer_service' },
];

const argv = process.argv.slice(2);
const DELETE = argv.includes('--delete');
const pwIdx = argv.indexOf('--password');
const FIXED_PW = pwIdx >= 0 ? argv[pwIdx + 1] : process.env.TEST_USER_PASSWORD;

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Always satisfies length + complexity policies; base64url avoids shell-hostile chars.
const genPassword = (): string => 'Qa1!' + randomBytes(18).toString('base64url');

async function findUserByEmail(email: string): Promise<User | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function setProfileRole(id: string, email: string, role: Role): Promise<void> {
  // handle_new_user() inserts a profiles row with role 'user' on signup; overwrite
  // it with the target role. Upsert covers the race where the trigger hasn't fired.
  const { error } = await sb.from('profiles').upsert({ id, email, role }, { onConflict: 'id' });
  if (error) throw error;
}

async function seed(): Promise<void> {
  const out: { email: string; role: Role; password: string; action: string }[] = [];
  for (const acct of ACCOUNTS) {
    const password = FIXED_PW ?? genPassword();
    const existing = await findUserByEmail(acct.email);
    let id: string;
    let action: string;
    if (existing) {
      const { error } = await sb.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      });
      if (error) throw error;
      id = existing.id;
      action = 'updated';
    } else {
      const { data, error } = await sb.auth.admin.createUser({
        email: acct.email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      id = data.user!.id;
      action = 'created';
    }
    await setProfileRole(id, acct.email, acct.role);
    out.push({ email: acct.email, role: acct.role, password, action });
  }

  console.log('\nTest accounts ready (email-confirmed, roles set):\n');
  for (const r of out) {
    console.log(`  [${r.action}] ${r.role.padEnd(16)} ${r.email}`);
    console.log(`             password: ${r.password}`);
  }

  const cs = out.find((r) => r.role === 'customer_service')!;
  const ed = out.find((r) => r.role === 'editor')!;
  console.log('\nOptional: add to .env.local so `npm run verify-rls` reuses these accounts:');
  console.log(`SUPABASE_TEST_USER_EMAIL=${cs.email}`);
  console.log(`SUPABASE_TEST_USER_PASSWORD=${cs.password}`);
  console.log(`SUPABASE_TEST_EDITOR_EMAIL=${ed.email}`);
  console.log(`SUPABASE_TEST_EDITOR_PASSWORD=${ed.password}\n`);
}

async function teardown(): Promise<void> {
  console.log('\nTeardown (FK constraints block any user that used chat/Reva):\n');
  for (const acct of ACCOUNTS) {
    const existing = await findUserByEmail(acct.email);
    if (!existing) {
      console.log(`  [absent]  ${acct.email}`);
      continue;
    }
    const { error } = await sb.auth.admin.deleteUser(existing.id);
    console.log(error ? `  [BLOCKED] ${acct.email} — ${error.message}` : `  [deleted] ${acct.email}`);
  }
  console.log('');
}

(DELETE ? teardown() : seed()).catch((e: unknown) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
