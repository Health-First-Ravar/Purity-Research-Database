'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../../../_components/Toast';

const EXAMPLE = `Q: Is PROTECT good for someone with acid reflux?
A: EASE is a better fit. The dark roast develops NMP from trigonelline degradation, which is associated with reduced gastric acid stimulation. PROTECT is lighter and may aggravate reflux for sensitive drinkers.

Q: Are your beans organic?
A: Yes. Every Purity coffee is USDA Organic certified, and we test every lot for heavy metals, pesticides, and mycotoxins.

Q: What's the difference between FLOW and PROTECT?
A: PROTECT is the antioxidant blend, lighter roast, highest CGA preservation. FLOW is the everyday balanced cup, balanced roast, balanced caffeine, designed for cognitive support and sustained energy.`;

type Pair = { question: string; answer: string };

export function BulkCanonForm() {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState<'draft' | 'active'>('draft');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Pair[] | null>(null);

  async function previewParse() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/editor/canon/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, preview: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Preview failed');
      setPreview(body.pairs ?? []);
      toast.push({ kind: 'info', message: `${body.count} pairs parsed.` });
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      const res = await fetch('/api/editor/canon/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, status, tags: tagList }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Insert failed');
      toast.push({
        kind: 'success',
        message: `Inserted ${body.inserted} of ${body.parsed} pairs as ${body.status}.`,
      });
      setText('');
      setPreview(null);
      router.push(`/editor/canon?tab=${status === 'active' ? 'active' : 'drafts'}`);
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-purity-muted dark:text-purity-mist">
            Paste Q&amp;A pairs
          </span>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); }}
            rows={20}
            placeholder={EXAMPLE}
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-purity-bean/15 bg-white p-3 text-sm font-mono outline-none focus:border-purity-green dark:border-purity-paper/15 dark:bg-purity-shade dark:text-purity-paper"
          />
        </label>
        <p className="text-[11px] text-purity-muted dark:text-purity-mist">
          Supported formats (auto-detected):
        </p>
        <ul className="ml-4 list-disc space-y-0.5 text-[11px] text-purity-muted dark:text-purity-mist">
          <li><strong>Q:/A:</strong> blocks separated by blank lines (most natural for paste)</li>
          <li><strong>TSV:</strong> one pair per line, question and answer separated by a tab</li>
          <li><strong>JSON:</strong> array of <code className="rounded bg-purity-cream/60 px-1 dark:bg-purity-ink/40">{`{question, answer}`}</code> objects</li>
        </ul>

        {preview && (
          <div className="mt-3 rounded-lg border border-purity-bean/10 bg-purity-cream/30 p-3 text-sm dark:border-purity-paper/10 dark:bg-purity-ink/20">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-purity-muted dark:text-purity-mist">
              Preview ({preview.length})
            </div>
            <ul className="max-h-[400px] space-y-2 overflow-y-auto">
              {preview.map((p, i) => (
                <li key={i} className="border-b border-dashed border-purity-bean/10 pb-2 last:border-b-0 dark:border-purity-paper/10">
                  <div className="text-xs font-medium">Q: {p.question}</div>
                  <div className="mt-0.5 line-clamp-3 text-xs text-purity-bean/80 dark:text-purity-paper/80">A: {p.answer}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <aside className="space-y-3 rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
        <h2 className="font-serif text-base">Settings</h2>
        <label className="block">
          <span className="block text-xs font-medium text-purity-muted dark:text-purity-mist">Initial status</span>
          <div className="mt-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setStatus('draft')}
              className={
                'rounded px-3 py-1.5 text-xs transition ' +
                (status === 'draft'
                  ? 'bg-purity-bean text-purity-cream dark:bg-purity-aqua dark:text-purity-ink'
                  : 'border border-purity-bean/20 hover:bg-purity-cream dark:border-purity-paper/20 dark:text-purity-paper dark:hover:bg-purity-ink/40')
              }
            >
              Draft (review first)
            </button>
            <button
              type="button"
              onClick={() => setStatus('active')}
              className={
                'rounded px-3 py-1.5 text-xs transition ' +
                (status === 'active'
                  ? 'bg-purity-green text-purity-cream dark:bg-purity-aqua dark:text-purity-ink'
                  : 'border border-purity-bean/20 hover:bg-purity-cream dark:border-purity-paper/20 dark:text-purity-paper dark:hover:bg-purity-ink/40')
              }
            >
              Active (skip review)
            </button>
          </div>
          <p className="mt-1 text-[11px] text-purity-muted dark:text-purity-mist">
            Drafts go to the Drafts tab for approval. Active goes live immediately, used by chat retrieval right away.
          </p>
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-purity-muted dark:text-purity-mist">
            Tags (comma-separated, applied to all)
          </span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="protect, antioxidants"
            className="mt-1 w-full rounded border border-purity-bean/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-purity-green dark:border-purity-paper/20 dark:text-purity-paper"
          />
          <p className="mt-1 text-[11px] text-purity-muted dark:text-purity-mist">
            Used by the heatmap (canon supply per topic) and editor filtering.
          </p>
        </label>

        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={previewParse}
            disabled={busy || !text.trim()}
            className="rounded border border-purity-bean/20 px-3 py-1.5 text-xs hover:bg-purity-cream disabled:opacity-50 dark:border-purity-paper/20 dark:text-purity-paper dark:hover:bg-purity-ink/40"
          >
            {busy ? 'Parsing…' : 'Preview parse'}
          </button>
          <button
            onClick={submit}
            disabled={busy || !text.trim()}
            className="rounded bg-purity-bean px-3 py-1.5 text-xs font-medium text-purity-cream hover:bg-purity-bean/85 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink dark:hover:bg-purity-aqua/85"
          >
            {busy ? 'Inserting…' : `Add ${preview ? preview.length + ' ' : ''}as ${status}`}
          </button>
        </div>
      </aside>
    </div>
  );
}
