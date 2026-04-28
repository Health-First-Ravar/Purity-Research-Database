'use client';

import { useState } from 'react';
import { useToast } from '../../_components/Toast';

// Thumbs-up / thumbs-down on a completed chat turn. Optimistic: flips immediately,
// rolls back on error. Re-clicking the same rating clears it (toggle-off).
// Writes to /api/chat/feedback which sets messages.user_rating.

export function RatingButtons({ messageId }: { messageId: string }) {
  const [rating, setRating] = useState<-1 | 0 | 1>(0);
  const [state, setState] = useState<'idle' | 'busy'>('idle');
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const toast = useToast();

  async function send(newRating: -1 | 1, maybeNote?: string) {
    const prev = rating;
    setRating(newRating);
    setState('busy');
    try {
      const res = await fetch('/api/chat/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, rating: newRating, note: maybeNote }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState('idle');
      toast.push({
        kind: 'success',
        message: newRating === 1 ? 'Thanks, marked helpful.' : 'Thanks, flagged for editor review.',
      });
      if (newRating === -1 && !maybeNote) setShowNote(true);
    } catch {
      setRating(prev);
      setState('idle');
      toast.push({ kind: 'error', message: 'Could not save rating. Try again in a moment.' });
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => send(1)}
        disabled={state === 'busy'}
        aria-label="This answer was helpful"
        className={
          'rounded border px-2 py-0.5 transition ' +
          (rating === 1
            ? 'border-purity-green bg-purity-green/10 text-purity-green'
            : 'border-purity-bean/20 text-purity-muted hover:border-purity-green hover:text-purity-green dark:border-purity-paper/20 dark:text-purity-mist')
        }
      >
        <span aria-hidden="true">👍</span>
      </button>
      <button
        type="button"
        onClick={() => send(-1)}
        disabled={state === 'busy'}
        aria-label="This answer was not helpful"
        className={
          'rounded border px-2 py-0.5 transition ' +
          (rating === -1
            ? 'border-purity-rust bg-purity-rust/10 text-purity-rust'
            : 'border-purity-bean/20 text-purity-muted hover:border-purity-rust hover:text-purity-rust dark:border-purity-paper/20 dark:text-purity-mist')
        }
      >
        <span aria-hidden="true">👎</span>
      </button>

      {showNote && rating === -1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) send(-1, note.trim());
            setShowNote(false);
          }}
          className="flex items-center gap-1"
        >
          <label htmlFor={`rate-note-${messageId}`} className="sr-only">What was off with this answer?</label>
          <input
            id={`rate-note-${messageId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="what was off? (optional)"
            autoFocus
            className="w-56 rounded border border-purity-bean/20 bg-transparent px-2 py-0.5 text-xs outline-none focus:border-purity-rust dark:border-purity-paper/20 dark:text-purity-paper"
          />
          <button type="submit" className="rounded bg-purity-rust px-2 py-0.5 text-purity-cream">save</button>
          <button
            type="button"
            onClick={() => setShowNote(false)}
            className="text-purity-muted dark:text-purity-mist"
          >
            skip
          </button>
        </form>
      )}
    </div>
  );
}
