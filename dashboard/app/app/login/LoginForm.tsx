'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

type Mode = 'login' | 'forgot';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/chat';

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.push(next);
    router.refresh();
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setSent(false);
  }

  /* ── Forgot password ─────────────────────────────────────────────── */
  if (mode === 'forgot') {
    return (
      <div className="space-y-3 rounded-lg border border-purity-bean/10 bg-white p-5 dark:border-purity-paper/10 dark:bg-purity-shade">
        {sent ? (
          <>
            <p className="text-sm text-purity-muted dark:text-purity-mist">
              Check your inbox — we sent a password reset link to <strong>{email}</strong>.
            </p>
            <button
              onClick={() => switchMode('login')}
              className="text-xs text-purity-green hover:underline dark:text-purity-aqua"
            >
              Back to sign in
            </button>
          </>
        ) : (
          <form onSubmit={handleForgot} className="space-y-3">
            <p className="text-sm text-purity-muted dark:text-purity-mist">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-purity-muted dark:text-purity-mist">Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-purity-bean/20 bg-white px-3 py-2 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
              />
            </label>
            {error && (
              <p className="rounded bg-purity-rust/10 px-3 py-2 text-xs text-purity-rust" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="w-full rounded-md bg-purity-bean px-4 py-2 text-sm font-medium text-purity-cream transition hover:bg-purity-bean/90 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="block text-xs text-purity-muted hover:underline dark:text-purity-mist"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    );
  }

  /* ── Sign in ─────────────────────────────────────────────────────── */
  return (
    <form
      onSubmit={handleLogin}
      className="space-y-3 rounded-lg border border-purity-bean/10 bg-white p-5 dark:border-purity-paper/10 dark:bg-purity-shade"
    >
      <label className="block text-sm">
        <span className="mb-1 block text-purity-muted dark:text-purity-mist">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-purity-bean/20 bg-white px-3 py-2 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-purity-muted dark:text-purity-mist">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-purity-bean/20 bg-white px-3 py-2 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
        />
      </label>
      {error && (
        <p className="rounded bg-purity-rust/10 px-3 py-2 text-xs text-purity-rust" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-purity-bean px-4 py-2 text-sm font-medium text-purity-cream transition hover:bg-purity-bean/90 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <button
        type="button"
        onClick={() => switchMode('forgot')}
        className="block text-xs text-purity-muted hover:underline dark:text-purity-mist"
      >
        Forgot password?
      </button>
    </form>
  );
}
