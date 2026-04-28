'use client';

import { useState } from 'react';
import { useToast } from './Toast';

export function ManualUpdateButton() {
  const [state, setState] = useState<'idle' | 'running' | 'ok' | 'capped'>('idle');
  const toast = useToast();

  async function trigger() {
    setState('running');
    try {
      const res = await fetch('/api/update/manual', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setState('capped');
        toast.push({ kind: 'info', message: j.error ?? 'Daily cap reached (3 manual updates / day).' });
        return;
      }
      if (!res.ok) {
        setState('idle');
        toast.push({ kind: 'error', message: j.error ?? 'Update failed.' });
        return;
      }
      setState('ok');
      toast.push({
        kind: 'success',
        message: `Checked ${j.sources_checked}, added ${j.sources_added}, updated ${j.sources_updated}.`,
      });
    } catch (e) {
      setState('idle');
      toast.push({ kind: 'error', message: `Network error: ${String(e)}` });
    }
  }

  const label = {
    idle: 'Manual update',
    running: 'Updating…',
    ok: 'Updated ✓',
    capped: 'Capped (3/day)',
  }[state];

  return (
    <button
      onClick={trigger}
      disabled={state === 'running'}
      aria-label={label}
      className="rounded-md border border-purity-green bg-purity-green px-3 py-1.5 text-sm font-medium text-purity-cream transition hover:bg-purity-green/90 disabled:opacity-60"
    >
      <span className="hidden sm:inline">{label}</span>
      <span aria-hidden="true" className="sm:hidden">↻</span>
    </button>
  );
}
