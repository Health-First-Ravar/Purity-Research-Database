'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/chat';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
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
    </form>
  );
}
