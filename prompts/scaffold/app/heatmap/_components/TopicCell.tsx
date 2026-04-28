'use client';

// One topic cell. Demand encoded as background-tint intensity (mapped from
// msg_count_30d to 0..1 against a soft ceiling). Supply encoded as a corner
// circle: filled if canon exists, hollow ring if it doesn't (gap).

import { useState } from 'react';
import { TopicDrawer } from './TopicDrawer';

export type HeatmapRow = {
  id: string;
  slug: string;
  label: string;
  category: string;
  description: string | null;
  msg_count_30d: number;
  msg_count_7d: number;
  msg_count_total: number;
  thumbs_down_total: number;
  escalated_total: number;
  canon_count: number;
  canon_draft_count: number;
  miss_rate: number | null;
  canon_gap: boolean;
  priority_score: number;
};

const DEMAND_CEILING = 25; // tune later; >=25 msgs/30d = full intensity

function intensity(count: number): number {
  return Math.max(0, Math.min(1, count / DEMAND_CEILING));
}

export function TopicCell({ row }: { row: HeatmapRow }) {
  const [open, setOpen] = useState(false);
  const i = intensity(row.msg_count_30d);

  // background built from purity-aqua at variable alpha; works in light + dark.
  const bg = `rgba(0, 159, 141, ${0.05 + i * 0.35})`;
  const border = row.canon_gap
    ? '2px solid rgba(176, 74, 46, 0.55)'   // purity-rust border for gaps
    : '1px solid rgba(0, 0, 0, 0.08)';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full text-left transition hover:scale-[1.01]"
        style={{ background: bg, border, borderRadius: 10, padding: 14 }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-purity-bean dark:text-purity-paper" title={row.label}>
              {row.label}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-purity-muted dark:text-purity-mist" title={row.slug}>
              {row.slug}
            </div>
          </div>
          {/* supply indicator */}
          <span
            aria-label={row.canon_count ? 'canon exists' : 'canon gap'}
            className={
              'mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full ' +
              (row.canon_count > 0
                ? 'border border-purity-green bg-purity-green dark:border-purity-aqua dark:bg-purity-aqua'
                : 'border-2 border-purity-rust bg-transparent')
            }
          />
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-purity-muted dark:text-purity-mist">
          <div>
            <dt>30d</dt>
            <dd className="font-medium text-purity-bean dark:text-purity-paper">{row.msg_count_30d}</dd>
          </div>
          <div>
            <dt>miss%</dt>
            <dd className="font-medium text-purity-bean dark:text-purity-paper">
              {row.miss_rate == null ? '—' : `${Math.round(Number(row.miss_rate) * 100)}%`}
            </dd>
          </div>
          <div>
            <dt>canon</dt>
            <dd className="font-medium text-purity-bean dark:text-purity-paper">
              {row.canon_count}
              {row.canon_draft_count ? <span className="text-purity-muted">/{row.canon_draft_count}d</span> : null}
            </dd>
          </div>
        </dl>
      </button>

      {open && <TopicDrawer row={row} onClose={() => setOpen(false)} />}
    </>
  );
}
