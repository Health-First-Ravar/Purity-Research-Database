'use client';

// Global error boundary for the app shell. Catches render/server errors
// in any route segment that doesn't define its own error.tsx.
//
// Next.js passes `error` + `reset()`; reset re-renders the boundary.

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Swap in Sentry.captureException(error) once wired.
    console.error('[app error]', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-purity-rust/20 bg-white p-6 text-sm dark:border-purity-rust/30 dark:bg-purity-shade">
      <h1 className="mb-2 font-serif text-lg text-purity-rust">Something broke</h1>
      <p className="mb-3 text-purity-bean dark:text-purity-paper">
        The page threw an error before it could render. The error has been logged.
      </p>
      {error.digest && (
        <p className="mb-3 text-xs text-purity-muted dark:text-purity-mist">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded-md bg-purity-bean px-3 py-1.5 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink"
        >
          Try again
        </button>
        <a
          href="/chat"
          className="rounded-md border border-purity-bean/20 px-3 py-1.5 text-xs text-purity-bean dark:border-purity-paper/20 dark:text-purity-paper"
        >
          Back to Research Hub
        </a>
      </div>
    </div>
  );
}
