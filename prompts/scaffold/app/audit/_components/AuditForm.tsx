'use client';

// Client form: textarea + context dropdown → POST /api/audit → render result card.

import { useState, useTransition } from 'react';
import { AuditResult, type AuditResponse } from './AuditResult';

const EXAMPLES = [
  {
    label: 'Overclaim example',
    body: "Our coffee prevents Alzheimer's because it's loaded with antioxidants.",
  },
  {
    label: 'Bioavailability gap example',
    body: 'PROTECT delivers higher CGAs because we roast lighter, which is why it supports liver health.',
  },
  {
    label: 'Mechanism + evidence example',
    body: 'Trigonelline degrades during dark roasting and is converted to NMP, which research suggests may reduce gastric acid stimulation.',
  },
];

export function AuditForm() {
  const [draft, setDraft] = useState('');
  const [context, setContext] = useState('newsletter');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (draft.trim().length < 12) {
      setError('Need at least 12 characters.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft, context }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(j.message ?? j.error ?? 'audit failed');
          return;
        }
        setResult(j as AuditResponse);
      } catch (e) {
        setError(`network error: ${String(e)}`);
      }
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
        <label htmlFor="audit-draft" className="text-xs uppercase tracking-wide text-purity-muted dark:text-purity-mist">
          Draft
        </label>
        <textarea
          id="audit-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste a sentence or short paragraph..."
          rows={8}
          className="mt-1 w-full rounded border border-purity-bean/20 bg-white px-2 py-1 text-sm dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper dark:placeholder:text-purity-mist/70"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-xs text-purity-muted dark:text-purity-mist">Context</label>
          <select
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="rounded border border-purity-bean/20 bg-white px-2 py-1 text-sm dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
          >
            <option value="newsletter">newsletter</option>
            <option value="module">module</option>
            <option value="chat_answer">chat answer</option>
            <option value="product_page">product page</option>
            <option value="other">other</option>
          </select>

          <button
            disabled={pending || draft.trim().length < 12}
            onClick={submit}
            className="ml-auto rounded-md bg-purity-bean px-4 py-1.5 text-xs text-purity-cream disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
          >
            {pending ? 'Auditing...' : 'Audit'}
          </button>
        </div>

        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wide text-purity-muted dark:text-purity-mist">Try one</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e.label}
                onClick={() => setDraft(e.body)}
                className="rounded border border-purity-bean/20 px-2 py-1 text-xs text-purity-muted hover:border-purity-green hover:text-purity-green dark:border-purity-paper/20 dark:text-purity-mist dark:hover:border-purity-aqua dark:hover:text-purity-aqua"
                type="button"
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-purity-rust">{error}</p>}
      </section>

      <section>
        {result ? (
          <AuditResult result={result} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-purity-bean/20 p-6 text-center text-sm text-purity-muted dark:border-purity-paper/20 dark:text-purity-mist">
            Audit results will appear here.
          </div>
        )}
      </section>
    </div>
  );
}
