'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return; }

    setError(null);
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(error.message); return; }

    router.push('/chat');
    router.refresh();
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-2 text-center font-serif text-2xl">Create your password</h1>
      <p className="mb-6 text-center text-sm text-purity-muted dark:text-purity-mist">
        Set a password to access Purity Lab.
      </p>
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-lg border border-purity-bean/10 bg-white p-5 dark:border-purity-paper/10 dark:bg-purity-shade"
      >
        <label className="block text-sm">
          <span className="mb-1 block text-purity-muted dark:text-purity-mist">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-purity-bean/20 bg-white px-3 py-2 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-purity-muted dark:text-purity-mist">Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
          disabled={busy || !password || !confirm}
          className="w-full rounded-md bg-purity-bean px-4 py-2 text-sm font-medium text-purity-cream transition hover:bg-purity-bean/90 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
        >
          {busy ? 'Saving…' : 'Set password & sign in'}
        </button>
      </form>
    </div>
  );
}
