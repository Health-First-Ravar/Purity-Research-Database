'use client';

export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-lg border border-purity-line px-3 py-1.5 text-sm font-semibold text-purity-teal hover:border-purity-aqua dark:border-purity-rule dark:text-purity-glow"
    >
      {label}
    </button>
  );
}
