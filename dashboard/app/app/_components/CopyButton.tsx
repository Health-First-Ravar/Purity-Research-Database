'use client';

// Small inline "Copy" affordance. Used next to chat assistant answers and
// anywhere else we want a one-click clipboard copy. Shows a 1.5-second
// "Copied" confirmation then resets. Falls back silently on clipboard-API
// failure (e.g. insecure context).

import { useState } from 'react';

export function CopyButton({
  text,
  label = 'Copy',
  className = '',
  ariaLabel,
}: {
  text: string;
  label?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers or insecure context — silently ignore.
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className={
        'rounded border border-purity-bean/20 px-2 py-0.5 text-xs text-purity-muted transition hover:border-purity-green hover:text-purity-green dark:border-purity-paper/20 dark:text-purity-mist dark:hover:border-purity-aqua dark:hover:text-purity-aqua ' +
        className
      }
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}
