'use client';

// Collapsible engineering view. Holds the original daily-breakdown table,
// untouched, so power users still have everything.

import { useState } from 'react';

type DailyRow = {
  day: string;
  total_messages: number;
  canon_hits: number;
  llm_calls: number;
  escalations: number;
  thumbs_up: number;
  thumbs_down: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_confidence: number | null;
  total_cost_usd: number | null;
};

export function EngineeringDetails({ daily }: { daily: DailyRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left text-sm font-medium text-purity-bean dark:text-purity-paper"
      >
        <span>Engineering details</span>
        <span aria-hidden>{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div className="max-h-[60vh] overflow-auto px-2 pb-2">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-xs text-purity-muted dark:text-purity-mist">
                <Th>Day</Th>
                <Th align="right">Msgs</Th>
                <Th align="right">Canon%</Th>
                <Th align="right">Escal%</Th>
                <Th align="right" aria-label="thumbs up">👍</Th>
                <Th align="right" aria-label="thumbs down">👎</Th>
                <Th align="right">p50 ms</Th>
                <Th align="right">p95 ms</Th>
                <Th align="right">Avg conf</Th>
                <Th align="right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => {
                const dayCanonRate = d.total_messages ? (d.canon_hits / d.total_messages) * 100 : null;
                const dayEscRate = d.total_messages ? (d.escalations / d.total_messages) * 100 : null;
                return (
                  <tr key={d.day} className="border-b border-purity-bean/5 dark:border-purity-paper/5">
                    <td className="p-2 font-mono text-xs">{d.day}</td>
                    <td className="p-2 text-right">{d.total_messages}</td>
                    <td className="p-2 text-right">{dayCanonRate == null ? '—' : `${dayCanonRate.toFixed(0)}%`}</td>
                    <td className="p-2 text-right">{dayEscRate == null ? '—' : `${dayEscRate.toFixed(0)}%`}</td>
                    <td className="p-2 text-right">{d.thumbs_up}</td>
                    <td className="p-2 text-right">{d.thumbs_down}</td>
                    <td className="p-2 text-right">{d.p50_latency_ms ?? '—'}</td>
                    <td className="p-2 text-right">{d.p95_latency_ms ?? '—'}</td>
                    <td className="p-2 text-right">{d.avg_confidence == null ? '—' : Number(d.avg_confidence).toFixed(2)}</td>
                    <td className="p-2 text-right">${Number(d.total_cost_usd ?? 0).toFixed(3)}</td>
                  </tr>
                );
              })}
              {daily.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-4 text-center text-purity-muted dark:text-purity-mist">No data yet in this window.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, align, ...rest }: { children: React.ReactNode; align?: 'left' | 'right' } & React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={
        'sticky top-0 z-10 border-b border-purity-bean/15 bg-purity-cream p-2 dark:border-purity-paper/15 dark:bg-purity-ink ' +
        (align === 'right' ? 'text-right' : 'text-left')
      }
      {...rest}
    >
      {children}
    </th>
  );
}
