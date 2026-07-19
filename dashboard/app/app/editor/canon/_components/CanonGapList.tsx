'use client';

// Canon gaps — the questions the system answered badly.
//
// This replaces `promotion_candidates` as the growth path for canon. That view
// filters on `user_rating = 1`, a customer thumbs-up, and in the app's whole
// history nobody has ever given one: 24 of 25 messages are unrated and one is a
// thumbs-down. A queue fed by an action nobody performs stays empty forever.
//
// `canon_misses` is the opposite — it fills itself as a byproduct of normal use
// (thumbs-down OR escalated OR insufficient_evidence) and already holds rows.
//
// The critical difference in handling: a promotion candidate is a GOOD answer
// you copy verbatim. A miss is an answer the system got WRONG. Promoting one
// as-is would canonise the failure and then serve it, with authority, ahead of
// the LLM path. So this queue does not offer a one-click promote — the editor
// must write the answer, and the button stays disabled until they do. The
// original answer is shown collapsed, as context for what went wrong, never as
// the default.

import { useState } from 'react';
import { useToast } from '../../../_components/Toast';

export type GapRow = {
  message_id: string;
  question: string;
  answer: string | null;
  classification: string | null;
  confidence_score: number | null;
  escalated: boolean;
  escalation_reason: string | null;
  insufficient_evidence: boolean;
  user_rating: number | null;
  user_rating_note: string | null;
  created_at: string;
};

export function CanonGapList({ rows }: { rows: GapRow[] }) {
  if (!rows.length) {
    return (
      <p className="rounded-md border border-purity-bean/15 bg-purity-cream/40 px-4 py-6 text-center text-sm text-purity-muted dark:border-purity-paper/15 dark:bg-purity-ink/30 dark:text-purity-mist">
        No open gaps. Every question the assistant struggled with has been
        answered or dismissed.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-purity-muted dark:text-purity-mist">
        Questions the assistant answered badly — escalated, short on evidence, or
        marked unhelpful. Write the answer you want served and promote it. The
        draft still goes through review before it goes live.
      </p>
      {rows.map((r) => (
        <GapCard key={r.message_id} row={r} />
      ))}
    </div>
  );
}

function GapCard({ row }: { row: GapRow }) {
  const toast = useToast();
  const [answer, setAnswer] = useState('');
  const [question, setQuestion] = useState(row.question);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  async function promote() {
    if (!answer.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/editor/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: row.message_id,
          label: 'promote_to_canon',
          // Explicit overrides: never inherit the failed answer.
          overrides: { question: question.trim(), answer: answer.trim() },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDone(true);
      toast.push({
        kind: 'success',
        message: 'Saved as a canon draft. Approve it in the Drafts tab to make it live.',
      });
    } catch (e) {
      toast.push({ kind: 'error', message: `Could not promote: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-purity-green/30 bg-purity-green/5 px-4 py-3 text-sm text-purity-muted dark:text-purity-mist">
        Draft created for “{row.question.slice(0, 70)}”. Review it in the Drafts tab.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-purity-bean/15 bg-white p-4 dark:border-purity-paper/15 dark:bg-purity-shade">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <ReasonBadges row={row} />
        <span className="ml-auto text-[10px] text-purity-muted dark:text-purity-mist">
          {row.created_at.slice(0, 10)}
        </span>
      </div>

      <label className="block text-[11px] uppercase tracking-wider text-purity-muted dark:text-purity-mist">
        Question
      </label>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded border border-purity-bean/20 bg-transparent px-2.5 py-1.5 text-sm dark:border-purity-paper/20 dark:text-purity-paper"
      />

      {row.answer && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="text-[11px] text-purity-muted underline-offset-2 hover:underline dark:text-purity-mist"
          >
            {showOriginal ? 'Hide' : 'Show'} the answer that failed
          </button>
          {showOriginal && (
            <p className="mt-1 whitespace-pre-wrap rounded border border-purity-bean/10 bg-purity-cream/40 p-2.5 text-xs text-purity-muted dark:border-purity-paper/10 dark:bg-purity-ink/30 dark:text-purity-mist">
              {row.answer}
            </p>
          )}
          {row.user_rating_note && (
            <p className="mt-1 text-[11px] italic text-purity-muted dark:text-purity-mist">
              Reader note: {row.user_rating_note}
            </p>
          )}
        </div>
      )}

      <label className="mt-3 block text-[11px] uppercase tracking-wider text-purity-muted dark:text-purity-mist">
        Answer to serve
      </label>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={4}
        placeholder="Write the answer a rep should receive for this question…"
        className="mt-1 w-full rounded border border-purity-bean/20 bg-transparent px-2.5 py-1.5 text-sm dark:border-purity-paper/20 dark:text-purity-paper"
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={promote}
          disabled={busy || !answer.trim()}
          className="rounded-md bg-purity-green px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-purity-aqua dark:text-purity-ink"
        >
          {busy ? 'Saving…' : 'Save as canon draft'}
        </button>
        {!answer.trim() && (
          <span className="text-[11px] text-purity-muted dark:text-purity-mist">
            Write an answer first — the failed one is never promoted as-is.
          </span>
        )}
      </div>
    </div>
  );
}

function ReasonBadges({ row }: { row: GapRow }) {
  const badges: string[] = [];
  if (row.escalated) badges.push(row.escalation_reason ? `escalated · ${row.escalation_reason}` : 'escalated');
  if (row.insufficient_evidence) badges.push('insufficient evidence');
  if (row.user_rating === -1) badges.push('marked unhelpful');
  if (typeof row.confidence_score === 'number') badges.push(`confidence ${row.confidence_score.toFixed(2)}`);
  if (row.classification) badges.push(row.classification);
  return (
    <>
      {badges.map((b) => (
        <span
          key={b}
          className="rounded-full bg-purity-cream px-2 py-0.5 text-[10px] uppercase tracking-wider text-purity-muted dark:bg-purity-ink/50 dark:text-purity-mist"
        >
          {b}
        </span>
      ))}
    </>
  );
}
