// Side panel that sits next to the analyte chart on /reports.
// Shows the strictest published limit for the currently-selected analyte.
// Limit data comes from the `coa_limits` table via lib/coa-limits.loadLimits()
// — the parent page does the load once and passes a single Limit (or null) here.

import type { Limit } from '@/lib/coa-limits';

export function AnalyteLimitsPanel({ analyteKey, analyteLabel, limit }: {
  analyteKey: string;
  analyteLabel: string;
  limit: Limit | null | undefined;
}) {
  return (
    <aside className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
      <div className="text-[10px] uppercase tracking-wider text-purity-muted dark:text-purity-mist">
        Strictest published limit
      </div>
      <h3 className="mt-1 font-serif text-base">{limit?.label ?? analyteLabel}</h3>

      {limit ? (
        <>
          <div className="mt-3 flex items-center gap-2">
            <DirectionBadge direction={limit.direction} />
            <span className="font-mono text-base">
              {limit.direction === 'ceiling' && limit.value != null && `< ${limit.value}`}
              {limit.direction === 'floor'   && limit.value != null && `≥ ${limit.value}`}
              {limit.direction === 'range'   && limit.min != null && limit.max != null && `${limit.min} – ${limit.max}`}
              {limit.unit ? <span className="ml-1 text-xs text-purity-muted dark:text-purity-mist">{limit.unit}</span> : null}
            </span>
          </div>

          <dl className="mt-3 space-y-2 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-purity-muted dark:text-purity-mist">Source</dt>
              <dd className="mt-0.5 text-purity-bean/90 dark:text-purity-paper/90">{limit.source}</dd>
            </div>
            {limit.notes && (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-purity-muted dark:text-purity-mist">Context</dt>
                <dd className="mt-0.5 leading-snug text-purity-muted dark:text-purity-mist">{limit.notes}</dd>
              </div>
            )}
          </dl>

          <div className="mt-4 rounded border border-purity-bean/10 bg-purity-cream/40 px-3 py-2 text-[11px] leading-snug text-purity-muted dark:border-purity-paper/10 dark:bg-purity-ink/30 dark:text-purity-mist">
            <strong className="font-medium text-purity-bean dark:text-purity-paper">Purity stance:</strong>{' '}
            Purity tests every lot for this analyte. Internal QC pass/fail thresholds are
            not publicly disclosed; the limit shown here is the strictest{' '}
            <em>published</em> reference (CHC, EU, FDA, etc.).
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-xs text-purity-muted dark:text-purity-mist">
            No public regulatory limit set for this analyte. Where applicable, Purity
            tracks typical-range references against the CHC Health-Grade Green Standard
            and lab-method LOQs.
          </p>
          <div className="mt-4 rounded border border-purity-bean/10 bg-purity-cream/40 px-3 py-2 text-[11px] leading-snug text-purity-muted dark:border-purity-paper/10 dark:bg-purity-ink/30 dark:text-purity-mist">
            <strong className="font-medium text-purity-bean dark:text-purity-paper">Purity stance:</strong>{' '}
            Internal QC pass/fail thresholds are not publicly disclosed.
          </div>
        </>
      )}

      <div className="mt-4 flex items-center justify-between text-[10px] text-purity-muted dark:text-purity-mist">
        <code className="rounded bg-purity-cream/60 px-1.5 py-0.5 dark:bg-purity-ink/40">{analyteKey}</code>
        <a href="/reports/limits" className="hover:text-purity-green dark:hover:text-purity-aqua">
          edit limits →
        </a>
      </div>
    </aside>
  );
}

function DirectionBadge({ direction }: { direction: Limit['direction'] }) {
  const styles: Record<Limit['direction'], { cls: string; label: string }> = {
    ceiling: { cls: 'bg-purity-rust/15 text-purity-rust',                                label: 'CEILING' },
    floor:   { cls: 'bg-purity-gold/15 text-purity-bean dark:text-purity-paper',         label: 'FLOOR'   },
    range:   { cls: 'bg-purity-green/15 text-purity-green dark:bg-purity-aqua/15 dark:text-purity-aqua', label: 'RANGE' },
  };
  const s = styles[direction];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${s.cls}`}>{s.label}</span>;
}
