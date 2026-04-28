'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type Rule = {
  id: string;
  pattern: string;
  pattern_type: 'contains' | 'regex';
  origin: string | null;
  region: string | null;
  notes: string | null;
  priority: number;
};

const EMPTY_DRAFT: Omit<Rule, 'id'> = {
  pattern: '',
  pattern_type: 'contains',
  origin: '',
  region: '',
  notes: '',
  priority: 100,
};

export function MappingsClient({ initial }: { initial: Rule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initial);
  const [draft, setDraft] = useState<Omit<Rule, 'id'>>({ ...EMPTY_DRAFT });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/reports/mappings');
    const json = await res.json();
    setRules(json.rules ?? []);
  }

  async function addRule() {
    if (!draft.pattern.trim()) return;
    setBusy(true);
    const res = await fetch('/api/reports/mappings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? 'add failed');
      return;
    }
    setDraft({ ...EMPTY_DRAFT });
    setMsg(null);
    refresh();
  }

  async function updateRule(id: string, patch: Partial<Rule>) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const res = await fetch(`/api/reports/mappings/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? 'update failed');
    }
  }

  async function deleteRule(id: string) {
    if (!confirm('Delete this rule?')) return;
    setRules((rs) => rs.filter((r) => r.id !== id));
    const res = await fetch(`/api/reports/mappings/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? 'delete failed');
      refresh();
    }
  }

  async function applyRules() {
    if (!confirm('Apply all rules to every COA? This updates origin/region in place.')) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/reports/mappings/apply', { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(j.error ?? 'apply failed');
      return;
    }
    setMsg(`applied — ${j.updated ?? 0} rows updated`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={applyRules}
          disabled={busy || rules.length === 0}
          className="rounded-md bg-purity-green px-4 py-1.5 text-xs font-medium text-purity-cream disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
        >
          {busy ? 'Working…' : 'Apply rules to all COAs'}
        </button>
        {msg && <span className="text-xs text-purity-muted dark:text-purity-mist">{msg}</span>}
      </div>

      <section className="rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
        <h2 className="mb-3 text-sm font-medium">Add rule</h2>
        <div className="grid gap-3 md:grid-cols-6">
          <DraftInput label="Pattern" value={draft.pattern} onChange={(v) => setDraft({ ...draft, pattern: v })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-purity-muted dark:text-purity-mist">Type</span>
            <select
              value={draft.pattern_type}
              onChange={(e) => setDraft({ ...draft, pattern_type: e.target.value as 'contains' | 'regex' })}
              className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
            >
              <option value="contains">contains</option>
              <option value="regex">regex</option>
            </select>
          </label>
          <DraftInput label="Origin" value={draft.origin ?? ''} onChange={(v) => setDraft({ ...draft, origin: v })} />
          <DraftInput label="Region" value={draft.region ?? ''} onChange={(v) => setDraft({ ...draft, region: v })} />
          <DraftInput
            label="Priority"
            value={String(draft.priority)}
            onChange={(v) => setDraft({ ...draft, priority: Number(v) || 100 })}
          />
          <DraftInput label="Notes" value={draft.notes ?? ''} onChange={(v) => setDraft({ ...draft, notes: v })} />
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={addRule}
            disabled={busy || !draft.pattern.trim()}
            className="rounded-md bg-purity-bean px-4 py-1.5 text-xs font-medium text-purity-cream disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
          >
            Add rule
          </button>
        </div>
      </section>

      <div className="overflow-x-auto rounded-lg border border-purity-bean/10 bg-white shadow-sm dark:border-purity-paper/10 dark:bg-purity-shade dark:shadow-none">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-purity-bean/10 text-left text-xs text-purity-muted dark:border-purity-paper/10 dark:text-purity-mist">
              <th className="p-3">Priority</th>
              <th className="p-3">Pattern</th>
              <th className="p-3">Type</th>
              <th className="p-3">Origin</th>
              <th className="p-3">Region</th>
              <th className="p-3">Notes</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={7} className="p-4 text-purity-muted dark:text-purity-mist">No rules yet.</td></tr>
            )}
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-purity-bean/5 dark:border-purity-paper/5">
                <td className="p-3"><CellInput value={String(r.priority)} onCommit={(v) => updateRule(r.id, { priority: Number(v) || 100 })} className="w-16" /></td>
                <td className="p-3"><CellInput value={r.pattern} onCommit={(v) => updateRule(r.id, { pattern: v })} /></td>
                <td className="p-3">
                  <select
                    value={r.pattern_type}
                    onChange={(e) => updateRule(r.id, { pattern_type: e.target.value as 'contains' | 'regex' })}
                    className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
                  >
                    <option value="contains">contains</option>
                    <option value="regex">regex</option>
                  </select>
                </td>
                <td className="p-3"><CellInput value={r.origin ?? ''} onCommit={(v) => updateRule(r.id, { origin: v || null })} /></td>
                <td className="p-3"><CellInput value={r.region ?? ''} onCommit={(v) => updateRule(r.id, { region: v || null })} /></td>
                <td className="p-3"><CellInput value={r.notes ?? ''} onCommit={(v) => updateRule(r.id, { notes: v || null })} /></td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() => deleteRule(r.id)}
                    className="text-xs text-purity-rust hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DraftInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-purity-muted dark:text-purity-mist">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
      />
    </label>
  );
}

function CellInput({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v); }}
      className={`rounded border border-transparent bg-transparent px-2 py-1 hover:border-purity-bean/20 focus:border-purity-bean/40 focus:bg-white focus:outline-none dark:hover:border-purity-paper/20 dark:focus:border-purity-paper/40 dark:focus:bg-purity-ink ${className ?? ''}`}
    />
  );
}
