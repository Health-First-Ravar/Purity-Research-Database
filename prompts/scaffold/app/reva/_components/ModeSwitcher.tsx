'use client';

// Three-button mode toggle inside the composer. Visual cue per mode.

export type Mode = 'create' | 'analyze' | 'challenge';

const MODES: { key: Mode; label: string; sub: string; cls: string }[] = [
  { key: 'create',    label: 'Create',    sub: 'draft, copy, modules',     cls: 'border-amber-400 text-amber-700 hover:bg-amber-400/10' },
  { key: 'analyze',   label: 'Analyze',   sub: 'what does this mean',      cls: 'border-purity-aqua text-purity-green hover:bg-purity-aqua/10 dark:text-purity-aqua' },
  { key: 'challenge', label: 'Challenge', sub: 'pressure-test this',       cls: 'border-purity-rust text-purity-rust hover:bg-purity-rust/10' },
];

const ACTIVE: Record<Mode, string> = {
  create:    'bg-amber-400 text-purity-bean border-amber-400',
  analyze:   'bg-purity-aqua text-purity-ink border-purity-aqua',
  challenge: 'bg-purity-rust text-purity-cream border-purity-rust',
};

export function ModeSwitcher({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {MODES.map((m) => {
        const active = m.key === mode;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            className={
              'rounded-md border px-3 py-1.5 text-xs transition ' +
              (active ? ACTIVE[m.key] : `bg-transparent ${m.cls}`)
            }
            title={m.sub}
            aria-pressed={active}
          >
            <div className="font-medium">{m.label}</div>
            <div className="text-[10px] opacity-75">{m.sub}</div>
          </button>
        );
      })}
    </div>
  );
}
