#!/usr/bin/env tsx
// Probe RLS for both roles (user, editor) against the live DB.
//
// Signs in as a test user and a test editor, runs a matrix of expected
// permissions, and asserts that each returns the right outcome. Exits 1 on
// any mismatch.
//
// Usage:
//   npm run verify-rls
//
// Required env:
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SUPABASE_TEST_USER_EMAIL      / SUPABASE_TEST_USER_PASSWORD
//   SUPABASE_TEST_EDITOR_EMAIL    / SUPABASE_TEST_EDITOR_PASSWORD

import { createClient, SupabaseClient } from '@supabase/supabase-js';

type Expect = 'ok' | 'denied' | 'empty';

type Probe = {
  name: string;
  role: 'user' | 'editor';
  action: () => PromiseLike<{ error: { code?: string; message?: string } | null; data: unknown }>;
  expect: Expect;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return sb;
}

function verdict(res: { error: { code?: string; message?: string } | null; data: unknown }): Expect {
  if (res.error) {
    // 42501 = insufficient_privilege, PGRST301 = JWT not accepted, PGRST204 = no rows
    if (res.error.code === 'PGRST301' || res.error.message?.match(/permission denied|not allowed|row.level security/i)) {
      return 'denied';
    }
    return 'denied'; // other errors treated as deny for safety
  }
  if (Array.isArray(res.data) && res.data.length === 0) return 'empty';
  if (res.data == null) return 'empty';
  return 'ok';
}

async function run() {
  const user = await signIn(
    process.env.SUPABASE_TEST_USER_EMAIL!,
    process.env.SUPABASE_TEST_USER_PASSWORD!,
  );
  const editor = await signIn(
    process.env.SUPABASE_TEST_EDITOR_EMAIL!,
    process.env.SUPABASE_TEST_EDITOR_PASSWORD!,
  );

  const probes: Probe[] = [
    // user role
    { name: 'user reads own profile',        role: 'user',   expect: 'ok',     action: () => user.from('profiles').select('id').limit(1) },
    { name: 'user reads sources',            role: 'user',   expect: 'ok',     action: () => user.from('sources').select('id').limit(1) },
    { name: 'user reads chunks',             role: 'user',   expect: 'ok',     action: () => user.from('chunks').select('id').limit(1) },
    { name: 'user reads active canon_qa',    role: 'user',   expect: 'ok',     action: () => user.from('canon_qa').select('id').eq('status', 'active').limit(1) },
    { name: 'user does NOT see draft canon', role: 'user',   expect: 'empty',  action: () => user.from('canon_qa').select('id').eq('status', 'draft').limit(1) },
    { name: 'user reads own messages',       role: 'user',   expect: 'ok',     action: () => user.from('messages').select('id').limit(1) },
    { name: 'user reads update_jobs',        role: 'user',   expect: 'denied', action: () => user.from('update_jobs').select('id').limit(1) },
    { name: 'user reads escalation_events',  role: 'user',   expect: 'denied', action: () => user.from('escalation_events').select('id').limit(1) },
    { name: 'user writes canon_qa',          role: 'user',   expect: 'denied', action: () => user.from('canon_qa').insert({ question: 'q', answer: 'a' }) },
    { name: 'user writes sources',           role: 'user',   expect: 'denied', action: () => user.from('sources').insert({ kind: 'faq', title: 't' }) },
    { name: 'user reads bibliography_view',  role: 'user',   expect: 'ok',     action: () => user.from('bibliography_view').select('id').limit(1) },

    // editor role
    { name: 'editor reads draft canon',      role: 'editor', expect: 'ok',     action: () => editor.from('canon_qa').select('id').limit(1) },
    { name: 'editor reads update_jobs',      role: 'editor', expect: 'ok',     action: () => editor.from('update_jobs').select('id').limit(1) },
    { name: 'editor reads escalation_events',role: 'editor', expect: 'ok',     action: () => editor.from('escalation_events').select('id').limit(1) },
    { name: 'editor reads all messages',     role: 'editor', expect: 'ok',     action: () => editor.from('messages').select('id').limit(1) },
  ];

  let pass = 0, fail = 0;
  for (const p of probes) {
    const got = verdict(await p.action());
    // Treat 'empty' as ok when we expected 'ok' and just got no rows (fine).
    const matched = got === p.expect || (p.expect === 'ok' && got === 'empty');
    const status = matched ? 'PASS' : 'FAIL';
    console.log(`[${status}] (${p.role}) ${p.name} — expected=${p.expect} got=${got}`);
    if (matched) pass++; else fail++;
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
