'use client';

import { useState } from 'react';
import { useToast } from '../../_components/Toast';

export function LabelButtons({ messageId }: { messageId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [lastLabel, setLastLabel] = useState<string>('');
  const toast = useToast();

  async function apply(l: 'good' | 'bad' | 'promote_to_canon') {
    // Promote writes a canon_qa draft row. Cheap to revert, but cheaper to
    // not fat-finger. Warn before firing — good/bad don't need it.
    if (l === 'promote_to_canon') {
      const ok = typeof window !== 'undefined'
        ? window.confirm('Promote this answer to a canon_qa draft? Editors still review before it goes live.')
        : true;
      if (!ok) return;
    }
    setState('busy');
    try {
      // Fire-and-forget claim event — idempotent server-side if already claimed
      // by the same editor.
      fetch('/api/editor/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId }),
      }).catch(() => {});
      const res = await fetch('/api/editor/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, label: l }),
      });
      if (res.ok) {
        setState('done');
        setLastLabel(l);
        const messages: Record<typeof l, string> = {
          good: 'Labeled good.',
          bad: 'Labeled bad. This feeds the canon triage queue.',
          promote_to_canon: 'Promoted to canon_qa draft. Review in the editor queue before it goes live.',
        };
        toast.push({ kind: 'success', message: messages[l] });
      } else {
        setState('idle');
        toast.push({ kind: 'error', message: 'Could not save label. Try again.' });
      }
    } catch {
      setState('idle');
      toast.push({ kind: 'error', message: 'Network error saving label.' });
    }
  }

  const done = state === 'done';

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <button
        onClick={() => apply('good')}
        className="rounded border border-purity-green px-2 py-1 text-purity-green transition hover:bg-purity-green/10 disabled:opacity-50"
        disabled={state === 'busy'}
      >
        <span aria-hidden="true">👍</span> good
      </button>
      <button
        onClick={() => apply('bad')}
        className="rounded border border-purity-rust px-2 py-1 text-purity-rust transition hover:bg-purity-rust/10 disabled:opacity-50"
        disabled={state === 'busy'}
      >
        <span aria-hidden="true">👎</span> bad
      </button>
      <button
        onClick={() => apply('promote_to_canon')}
        className="rounded border border-purity-bean px-2 py-1 transition hover:bg-purity-bean/5 disabled:opacity-50 dark:border-purity-paper/60 dark:text-purity-paper dark:hover:bg-purity-paper/5"
        disabled={state === 'busy'}
      >
        <span aria-hidden="true">★</span> promote to canon
      </button>
      {done && (
        <span className="self-center text-purity-muted dark:text-purity-mist" aria-live="polite">
          last: {lastLabel}
        </span>
      )}
    </div>
  );
}
