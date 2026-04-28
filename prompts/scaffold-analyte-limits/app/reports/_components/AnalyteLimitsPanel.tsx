// Server component (no client-only deps). Drop into reports page next to the
// chart. Takes the selected analyte key from the URL search params and renders
// the limits + Purity stance + "why we test" block.

import { getAnalyteLimit, type AnalyteKind } from '@/lib/analytes/limits';

const KIND_LABEL: Record<AnalyteKind, string> = {
  mycotoxin: 'Mycotoxin',
  process_contaminant: 'Process contaminant',
  heavy_metal: 'Heavy metal',
  pesticide: 'Pesticide',
  emerging: 'Emerging contaminant',
  qc: 'Quality control',
  bioactive: 'Bioactive (not contaminant)',
};

const KIND_TONE: Record<AnalyteKind, string> = {
  mycotoxin:           'bg-purity-rust/10 text-purity-rust',
  process_contaminant: 'bg-purity-rust/10 text-purity-rust',
  heavy_metal:         'bg-purity-rust/10 text-purity-rust',
  pesticide:           'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  emerging:            'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  qc:                  'bg-purity-aqua/15 text-purity-green dark:text-purity-aqua',
  bioactive:           'bg-purity-green/10 text-purity-green dark:text-purity-aqua',
};

export function AnalyteLimitsPanel({ analyteKey }: { analyteKey: string }) {
  const limit = getAnalyteLimit(analyteKey);

  if (!limit) {
    return (
      <aside className="rounded-lg border border-purity-bean/10 bg-purity-cream/40 p-4 text-sm text-purity-muted dark:border-purity-paper/10 dark:bg-purity-ink/40 dark:text-purity-mist">
        No specific guideline mapped for <code className="font-mono">{analyteKey}</code>.
        Add a mapping to <code className="font-mono">lib/analytes/limits.ts</code>.
      </aside>
    );
  }

  return (
    <aside className="space-y-4 rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
      <header>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${KIND_TONE[limit.kind]}`}>
            {KIND_LABEL[limit.kind]}
          </span>
          <span className="text-xs text-purity-muted dark:text-purity-mist">{limit.unit}</span>
        </div>
        <h3 className="mt-1 font-serif text-lg text-purity-bean dark:text-purity-paper">{limit.label}</h3>
      </header>

      <section>
        <h4 className="mb-1 text-[11px] uppercase tracking-wide text-purity-muted dark:text-purity-mist">
          {limit.kind === 'bioactive' ? 'Typical ranges' : 'Regulatory + industry references'}
        </h4>
        {limit.kind === 'bioactive' && limit.typicalRange?.length ? (
          <table className="w-full text-xs">
            <tbody>
              {limit.typicalRange.map((r) => (
                <tr key={r.roast} className="border-b border-purity-bean/5 dark:border-purity-paper/5">
                  <td className="py-1 pr-2 text-purity-muted dark:text-purity-mist">{r.roast}</td>
                  <td className="py-1 font-medium text-purity-bean dark:text-purity-paper">{r.range}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {limit.references.map((r, i) => (
                <tr key={`${r.body}-${i}`} className="border-b border-purity-bean/5 dark:border-purity-paper/5 align-top">
                  <td className="py-1 pr-2 text-purity-muted dark:text-purity-mist">{r.body}</td>
                  <td className="py-1 text-purity-bean dark:text-purity-paper">
                    <div className="font-medium">{r.value}</div>
                    {r.matrix && <div className="text-[11px] text-purity-muted dark:text-purity-mist">{r.matrix}</div>}
                    {r.notes && <div className="text-[11px] text-purity-muted dark:text-purity-mist italic">{r.notes}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h4 className="mb-1 text-[11px] uppercase tracking-wide text-purity-muted dark:text-purity-mist">
          Why we test
        </h4>
        <p className="text-purity-bean dark:text-purity-paper">{limit.whyWeTest}</p>
      </section>

      <section className="rounded-md border border-purity-green/30 bg-purity-green/5 p-3 dark:border-purity-aqua/30 dark:bg-purity-aqua/10">
        <h4 className="mb-1 text-[11px] uppercase tracking-wide text-purity-green dark:text-purity-aqua">
          Purity stance
        </h4>
        <p className="text-purity-bean dark:text-purity-paper">{limit.purityStance}</p>
      </section>

      {limit.chartThreshold != null && (
        <p className="text-[11px] text-purity-muted dark:text-purity-mist">
          Reference line shown on chart at <strong>{limit.chartThreshold} {limit.unit.replace(/\s*\(.*\)/, '')}</strong>{limit.chartThresholdLabel ? ` — ${limit.chartThresholdLabel}` : ''}.
        </p>
      )}
    </aside>
  );
}
