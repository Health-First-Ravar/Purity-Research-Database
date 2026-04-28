'use client';

import { useState } from 'react';
import { useToast } from '../../../_components/Toast';

type Draft = {
  id: string;
  question: string;
  answer: string;
  created_at: string;
  created_by: string | null;
  origin_message_id: string | null;
};

export function CanonDraftCard({ draft, onSettle }: { draft: Draft; onSettle: (id: string) => void }) {
  const [state, setState] = useState<'idle' | 'editing' | 'busy'>('idle');
  const [editQ, setEditQ] = useState(draft.question);
  const [editA, setEditA] = useState(draft.answer);
  const toast = useToast();

  async function act(action: 'approve' | 'reject') {
    setState('busy');
    const optimisticId = draft.id;
    try {
      const res = await fetch(`/api/editor/canon/${draft.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          question: action === 'approve' ? editQ : undefined,
          answer: action === 'approve' ? editA : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? String(res.status));
      }
      toast.push({
        kind: 'success',
        message: action === 'approve' ? 'Approved and live in canon.' : 'Rejected and archived.',
      });
      onSettle(optimisticId);
    } catch (err) {
      setState(state === 'editing' ? 'editing' : 'idle');
      toast.push({ kind: 'error', message: String(err) });
    }
  }

  const busy = state === 'busy';

  return (
    <li className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-purity-muted dark:text-purity-mist">
        <span>Created {new Date(draft.created_at).toLocaleDateString()}</span>
        {draft.origin_message_id && (
          <a
            href={`/editor?highlight=${draft.origin_message_id}`}
            className="underline hover:text-purity-green dark:hover:text-purity-aqua"
          >
            view source message
          </a>
        )}
      </div>

      {state === 'editing' ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs font-medium text-purity-muted dark:text-purity-mist">Question</span>
            <textarea
              value={editQ}
              onChange={(e) => setEditQ(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-purity-bean/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-purity-green dark:border-purity-paper/20 dark:text-purity-paper"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-purity-muted dark:text-purity-mist">Answer</span>
            <textarea
              value={editA}
              onChange={(e) => setEditA(e.target.value)}
              rows={5}
              className="mt-1 w-full rounded border border-purity-bean/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-purity-green dark:border-purity-paper/20 dark:text-purity-paper"
            />
          </label>
        </div>
      ) : (
        <>
          <div className="font-medium">Q: {draft.question}</div>
          <div className="mt-1 whitespace-pre-wrap text-purity-bean/90 dark:text-purity-paper/90">
            A: {draft.answer}
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {state !== 'editing' ? (
          <button
            onClick={() => setState('editing')}
            disabled={busy}
            className="rounded border border-purity-bean/20 px-3 py-1 text-xs transition hover:border-purity-bean disabled:opacity-50 dark:border-purity-paper/30 dark:text-purity-paper"
          >
            Edit
          </button>
        ) : (
          <button
            onClick={() => setState('idle')}
            disabled={busy}
            className="rounded border border-purity-bean/20 px-3 py-1 text-xs transition hover:border-purity-bean disabled:opacity-50 dark:border-purity-paper/30 dark:text-purity-paper"
          >
            Cancel edit
          </button>
        )}
        <button
          onClick={() => act('approve')}
          disabled={busy}
          className="rounded bg-purity-green px-3 py-1 text-xs text-purity-cream transition hover:bg-purity-green/80 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
        >
          {state === 'editing' ? 'Save and approve' : 'Approve'}
        </button>
        <button
          onClick={() => act('reject')}
          disabled={busy}
          className="rounded border border-purity-rust px-3 py-1 text-xs text-purity-rust transition hover:bg-purity-rust/10 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </li>
  );
}
