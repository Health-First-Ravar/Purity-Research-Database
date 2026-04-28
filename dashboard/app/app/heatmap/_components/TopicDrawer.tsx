'use client';

// Drawer: shows recent messages tagged with this topic, plus quick-promote CTA
// to the editor canon flow. Fetches from a small JSON endpoint inline so the
// page stays static-fast.

import { useEffect, useState } from 'react';
import type { HeatmapRow } from './TopicCell';

type Msg = {
  id: string;
  question: string;
  answer: string | null;
  user_rating: number | null;
  escalated: boolean;
  insufficient_evidence: boolean;
  confidence_score: number | null;
  created_at: string;
};

export function TopicDrawer({ row, onClose }: { row: HeatmapRow; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/heatmap/topic-messages?topic_id=${row.id}`);
        const j = await res.json();
        if (!active) return;
        if (!res.ok) { setErr(j.error ?? 'load failed'); return; }
        setMsgs(j.messages ?? []);
      } catch (e) {
        if (active) setErr(`network: ${String(e)}`);
      }
    })();
    return () => { active = false; };
  }, [row.id]);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-xl overflow-auto bg-purity-cream p-6 shadow-xl dark:bg-purity-shade"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-serif text-xl text-purity-bean dark:text-purity-paper">{row.label}</h2>
            <p className="text-xs text-purity-muted dark:text-purity-mist">{row.slug} · {row.category}</p>
            {row.description && <p className="mt-1 text-sm text-purity-bean/80 dark:text-purity-paper/80">{row.description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-purity-muted hover:text-purity-bean dark:text-purity-mist dark:hover:text-purity-paper"
          >
            Close
          </button>
        </div>

        <dl className="mb-4 grid grid-cols-4 gap-3 text-[11px] uppercase tracking-wide text-purity-muted dark:text-purity-mist">
          <Stat dt="msgs 30d" dd={String(row.msg_count_30d)} />
          <Stat dt="msgs total" dd={String(row.msg_count_total)} />
          <Stat dt="miss rate" dd={row.miss_rate == null ? '—' : `${Math.round(Number(row.miss_rate) * 100)}%`} />
          <Stat dt="canon" dd={`${row.canon_count} active${row.canon_draft_count ? ` · ${row.canon_draft_count} draft` : ''}`} />
        </dl>

        {row.canon_gap && (
          <div className="mb-4 rounded-md border border-purity-rust/30 bg-purity-rust/5 p-3 text-sm text-purity-rust">
            Gap: at least {row.msg_count_30d} questions in the last 30 days, no active canon. Write one.
          </div>
        )}

        <a
          href={`/editor/canon?topic=${encodeURIComponent(row.slug)}`}
          className="mb-4 inline-block rounded-md bg-purity-bean px-3 py-1.5 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink"
        >
          Draft canon for this topic →
        </a>

        <h3 className="mb-2 mt-4 text-xs uppercase tracking-wide text-purity-muted dark:text-purity-mist">
          Recent messages
        </h3>
        {err && <p className="text-sm text-purity-rust">{err}</p>}
        {!msgs && !err && <p className="text-sm text-purity-muted dark:text-purity-mist">Loading...</p>}
        {msgs && msgs.length === 0 && <p className="text-sm text-purity-muted dark:text-purity-mist">No messages yet.</p>}
        <ul className="space-y-3">
          {msgs?.map((m) => (
            <li key={m.id} className="rounded-md border border-purity-bean/10 bg-white p-3 text-sm dark:border-purity-paper/10 dark:bg-purity-ink">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-purity-muted dark:text-purity-mist">
                <span>{new Date(m.created_at).toLocaleString()}</span>
                {m.user_rating === 1 && <span className="text-purity-green dark:text-purity-aqua">👍</span>}
                {m.user_rating === -1 && <span className="text-purity-rust">👎</span>}
                {m.escalated && <span className="rounded bg-purity-rust/15 px-1.5 py-0.5 text-purity-rust">escalated</span>}
                {m.insufficient_evidence && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700">insufficient</span>}
                {m.confidence_score != null && <span>conf {m.confidence_score.toFixed(2)}</span>}
              </div>
              <p className="font-medium text-purity-bean dark:text-purity-paper">{m.question}</p>
              {m.answer && <p className="mt-1 line-clamp-3 text-purity-bean/80 dark:text-purity-paper/80">{m.answer}</p>}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function Stat({ dt, dd }: { dt: string; dd: string }) {
  return (
    <div>
      <dt>{dt}</dt>
      <dd className="text-sm font-medium normal-case text-purity-bean dark:text-purity-paper">{dd}</dd>
    </div>
  );
}
