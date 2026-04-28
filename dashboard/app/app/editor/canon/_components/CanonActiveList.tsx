'use client';

// Editable list for active / deprecated canon entries. Each row can be:
//   - edited (question/answer)
//   - status-flipped (active ↔ deprecated)
//   - tagged
// All writes go through PATCH /api/editor/canon/[id].

import { useState } from 'react';
import { useToast } from '../../../_components/Toast';
import { EmptyState } from '../../../_components/EmptyState';

type CanonRow = {
  id: string;
  question: string;
  answer: string;
  status: 'draft' | 'active' | 'deprecated';
  tags: string[] | null;
  created_at: string;
  last_reviewed_at: string | null;
  origin_message_id: string | null;
};

export function CanonActiveList({ rows, tab }: { rows: CanonRow[]; tab: 'active' | 'deprecated' }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        tone={tab === 'active' ? 'neutral' : 'success'}
        title={tab === 'active' ? 'No active canon yet.' : 'No deprecated entries.'}
        body={
          tab === 'active'
            ? 'Approve drafts in the Drafts tab, or use Bulk add to seed canon directly.'
            : 'Nothing here is being archived. That\'s a good sign.'
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <CanonEditableCard key={r.id} row={r} tab={tab} />
      ))}
    </ul>
  );
}

function CanonEditableCard({ row, tab }: { row: CanonRow; tab: 'active' | 'deprecated' }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(row.question);
  const [a, setA] = useState(row.answer);
  const [tagsInput, setTagsInput] = useState((row.tags ?? []).join(', '));
  const [hidden, setHidden] = useState(false);
  const toast = useToast();

  if (hidden) return null;

  async function patch(payload: Record<string, unknown>, successMessage: string, hideAfter = false) {
    setBusy(true);
    try {
      const res = await fetch(`/api/editor/canon/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? String(res.status));
      }
      toast.push({ kind: 'success', message: successMessage });
      if (hideAfter) setHidden(true);
      else setEditing(false);
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function saveEdits() {
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    const payload: Record<string, unknown> = {};
    if (q !== row.question) payload.question = q;
    if (a !== row.answer)   payload.answer = a;
    const oldTags = (row.tags ?? []).join(',');
    if (tags.join(',') !== oldTags) payload.tags = tags;
    if (Object.keys(payload).length === 0) {
      toast.push({ kind: 'info', message: 'No changes to save.' });
      setEditing(false);
      return;
    }
    await patch(payload, 'Updated.');
  }

  return (
    <li className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-purity-muted dark:text-purity-mist">
        <div className="flex items-center gap-2">
          <StatusBadge status={row.status} />
          <span>
            Last reviewed {row.last_reviewed_at ? new Date(row.last_reviewed_at).toLocaleDateString() : '—'}
          </span>
        </div>
        {row.origin_message_id && (
          <a href={`/editor?highlight=${row.origin_message_id}`} className="underline hover:text-purity-green dark:hover:text-purity-aqua">
            view source message
          </a>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Field label="Question">
            <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2}
              className="w-full rounded border border-purity-bean/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-purity-green dark:border-purity-paper/20 dark:text-purity-paper" />
          </Field>
          <Field label="Answer">
            <textarea value={a} onChange={(e) => setA(e.target.value)} rows={6}
              className="w-full rounded border border-purity-bean/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-purity-green dark:border-purity-paper/20 dark:text-purity-paper" />
          </Field>
          <Field label="Tags (comma-separated)">
            <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
              className="w-full rounded border border-purity-bean/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-purity-green dark:border-purity-paper/20 dark:text-purity-paper" />
          </Field>
        </div>
      ) : (
        <>
          <div className="font-medium">Q: {row.question}</div>
          <div className="mt-1 whitespace-pre-wrap text-purity-bean/90 dark:text-purity-paper/90">A: {row.answer}</div>
          {row.tags && row.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {row.tags.map((t) => (
                <span key={t} className="rounded-full bg-purity-cream/60 px-2 py-0.5 text-[10px] text-purity-muted dark:bg-purity-ink/40 dark:text-purity-mist">
                  {t}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!editing ? (
          <>
            <button onClick={() => setEditing(true)} disabled={busy}
              className="rounded border border-purity-bean/20 px-3 py-1 text-xs hover:border-purity-bean disabled:opacity-50 dark:border-purity-paper/30 dark:text-purity-paper">
              Edit
            </button>
            {tab === 'active' && (
              <button onClick={() => patch({ status: 'deprecated' }, 'Deprecated.', true)} disabled={busy}
                className="rounded border border-purity-rust/40 px-3 py-1 text-xs text-purity-rust hover:bg-purity-rust/10 disabled:opacity-50">
                Deprecate
              </button>
            )}
            {tab === 'deprecated' && (
              <button onClick={() => patch({ status: 'active' }, 'Restored to active.', true)} disabled={busy}
                className="rounded bg-purity-green px-3 py-1 text-xs text-purity-cream hover:bg-purity-green/85 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink">
                Restore (active)
              </button>
            )}
          </>
        ) : (
          <>
            <button onClick={saveEdits} disabled={busy}
              className="rounded bg-purity-green px-3 py-1 text-xs text-purity-cream hover:bg-purity-green/85 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink">
              Save
            </button>
            <button onClick={() => { setEditing(false); setQ(row.question); setA(row.answer); setTagsInput((row.tags ?? []).join(', ')); }} disabled={busy}
              className="rounded border border-purity-bean/20 px-3 py-1 text-xs hover:border-purity-bean disabled:opacity-50 dark:border-purity-paper/30 dark:text-purity-paper">
              Cancel
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-purity-muted dark:text-purity-mist">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:      'bg-purity-gold/15 text-purity-bean dark:bg-purity-gold/15 dark:text-purity-paper',
    active:     'bg-purity-green/15 text-purity-green dark:bg-purity-aqua/15 dark:text-purity-aqua',
    deprecated: 'bg-purity-rust/15 text-purity-rust',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${styles[status] ?? ''}`}>
      {status}
    </span>
  );
}
