'use client';

import { useEffect, useState } from 'react';
import { useToast } from '../../../_components/Toast';

type Limit = {
  id: string;
  key: string;
  label: string;
  unit: string;
  category: 'mycotoxin' | 'process_contaminant' | 'heavy_metal' | 'pesticide' | 'quality' | 'bioactive';
  direction: 'ceiling' | 'floor' | 'range';
  value: number | null;
  min_value: number | null;
  max_value: number | null;
  source: string;
  notes: string | null;
  display_order: number | null;
  active: boolean;
};

const CATEGORIES: Limit['category'][] = ['mycotoxin','process_contaminant','heavy_metal','pesticide','quality','bioactive'];
const DIRECTIONS: Limit['direction'][] = ['ceiling','floor','range'];

const CATEGORY_LABEL: Record<Limit['category'], string> = {
  mycotoxin:           'Mycotoxin',
  process_contaminant: 'Process contaminant',
  heavy_metal:         'Heavy metal',
  pesticide:           'Pesticide',
  quality:             'Quality',
  bioactive:           'Bioactive',
};

export function LimitsClient() {
  const [limits, setLimits] = useState<Limit[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  async function refresh() {
    const res = await fetch('/api/admin/limits', { cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      setLimits(body.limits ?? []);
    } else {
      toast.push({ kind: 'error', message: 'Failed to load limits.' });
    }
  }
  // refresh is stable enough for this use; intentionally not in deps to keep the fetch one-shot on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function patch(id: string, payload: Partial<Limit> & { min?: number | null; max?: number | null }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/limits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Save failed');
      toast.push({ kind: 'success', message: 'Saved.' });
      await refresh();
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function softDelete(id: string) {
    if (!confirm('Soft-delete this limit? It can be restored from the inactive list.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/limits/${id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Delete failed');
      toast.push({ kind: 'success', message: 'Deactivated.' });
      await refresh();
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (limits == null) {
    return <div className="rounded-lg border border-purity-bean/10 bg-white p-6 text-sm text-purity-muted dark:border-purity-paper/10 dark:bg-purity-shade dark:text-purity-mist">Loading…</div>;
  }

  const visible = limits.filter((l) => showInactive || l.active);
  const grouped = new Map<Limit['category'], Limit[]>();
  for (const l of visible) {
    const arr = grouped.get(l.category) ?? [];
    arr.push(l);
    grouped.set(l.category, arr);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setAdding(true)}
          className="rounded-md bg-purity-bean px-3 py-1.5 text-xs font-medium text-purity-cream hover:bg-purity-bean/85 dark:bg-purity-aqua dark:text-purity-ink dark:hover:bg-purity-aqua/85"
        >
          + Add limit
        </button>
        <label className="flex items-center gap-2 text-xs text-purity-muted dark:text-purity-mist">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive ({limits.filter((l) => !l.active).length})
        </label>
      </div>

      {adding && (
        <NewLimitForm
          onCancel={() => setAdding(false)}
          onCreated={() => { setAdding(false); refresh(); }}
        />
      )}

      {CATEGORIES.map((cat) => {
        const rows = grouped.get(cat) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={cat} className="rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
            <h2 className="border-b border-purity-bean/10 px-4 py-2 text-[11px] uppercase tracking-wider text-purity-muted dark:border-purity-paper/10 dark:text-purity-mist">
              {CATEGORY_LABEL[cat]} ({rows.length})
            </h2>
            <ul>
              {rows.map((l) => (
                <LimitRow key={l.id} row={l} onSave={patch} onDelete={softDelete} disabled={busy} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LimitRow({ row, onSave, onDelete, disabled }: {
  row: Limit;
  onSave: (id: string, payload: Partial<Limit> & { min?: number | null; max?: number | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    label: row.label,
    unit: row.unit,
    direction: row.direction,
    value: row.value ?? '',
    min: row.min_value ?? '',
    max: row.max_value ?? '',
    source: row.source,
    notes: row.notes ?? '',
    category: row.category,
  });

  function reset() {
    setEditing(false);
    setForm({
      label: row.label, unit: row.unit, direction: row.direction,
      value: row.value ?? '', min: row.min_value ?? '', max: row.max_value ?? '',
      source: row.source, notes: row.notes ?? '', category: row.category,
    });
  }

  function fmtLimit(): string {
    if (row.direction === 'ceiling' && row.value != null) return `< ${row.value} ${row.unit}`.trim();
    if (row.direction === 'floor'   && row.value != null) return `≥ ${row.value} ${row.unit}`.trim();
    if (row.direction === 'range'   && row.min_value != null && row.max_value != null) return `${row.min_value}–${row.max_value} ${row.unit}`.trim();
    return '—';
  }

  if (!editing) {
    return (
      <li className={`flex flex-wrap items-start justify-between gap-3 border-b border-purity-bean/5 px-4 py-3 text-sm last:border-b-0 dark:border-purity-paper/5 ${row.active ? '' : 'opacity-50'}`}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.label}</span>
            <code className="rounded bg-purity-cream/60 px-1.5 py-0 text-[10px] text-purity-muted dark:bg-purity-ink/40 dark:text-purity-mist">
              {row.key}
            </code>
            <DirectionBadge direction={row.direction} />
            {!row.active && <span className="rounded-full bg-purity-rust/15 px-2 py-0 text-[10px] uppercase tracking-wider text-purity-rust">inactive</span>}
          </div>
          <div className="mt-1 font-mono text-sm">{fmtLimit()}</div>
          <div className="mt-1 text-[11px] text-purity-muted dark:text-purity-mist">{row.source}</div>
          {row.notes && <div className="mt-1 text-[11px] text-purity-muted/80 dark:text-purity-mist/80">{row.notes}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(true)} disabled={disabled}
            className="rounded border border-purity-bean/20 px-2.5 py-1 text-xs hover:border-purity-bean disabled:opacity-50 dark:border-purity-paper/30 dark:text-purity-paper">
            Edit
          </button>
          {row.active ? (
            <button onClick={() => onDelete(row.id)} disabled={disabled}
              className="rounded border border-purity-rust/40 px-2.5 py-1 text-xs text-purity-rust hover:bg-purity-rust/10 disabled:opacity-50">
              Deactivate
            </button>
          ) : (
            <button onClick={() => onSave(row.id, { active: true })} disabled={disabled}
              className="rounded bg-purity-green px-2.5 py-1 text-xs text-purity-cream hover:bg-purity-green/85 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink">
              Restore
            </button>
          )}
        </div>
      </li>
    );
  }

  // Editing mode
  return (
    <li className="border-b border-purity-bean/5 px-4 py-3 last:border-b-0 dark:border-purity-paper/5">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Label">
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Unit (e.g. ppb, mg/g, %)">
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Direction">
          <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as Limit['direction'] })} className={inputCls}>
            {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Limit['category'] })} className={inputCls}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </Field>
        {form.direction !== 'range' ? (
          <Field label={form.direction === 'ceiling' ? 'Max value (over → red)' : 'Min value (under → red)'}>
            <input type="number" step="any" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value as unknown as number })} className={inputCls} />
          </Field>
        ) : (
          <>
            <Field label="Min value">
              <input type="number" step="any" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value as unknown as number })} className={inputCls} />
            </Field>
            <Field label="Max value">
              <input type="number" step="any" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value as unknown as number })} className={inputCls} />
            </Field>
          </>
        )}
        <Field label="Source" className="md:col-span-2">
          <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Notes (optional)" className="md:col-span-2">
          <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          disabled={disabled}
          onClick={() => onSave(row.id, {
            label: form.label, unit: form.unit, direction: form.direction, category: form.category,
            value: form.direction === 'range' ? null : (form.value === '' ? null : Number(form.value)),
            min:   form.direction === 'range' ? (form.min === '' ? null : Number(form.min)) : null,
            max:   form.direction === 'range' ? (form.max === '' ? null : Number(form.max)) : null,
            source: form.source,
            notes: form.notes || null,
          }).then(() => setEditing(false))}
          className="rounded bg-purity-green px-3 py-1 text-xs text-purity-cream hover:bg-purity-green/85 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
        >
          Save
        </button>
        <button onClick={reset} disabled={disabled}
          className="rounded border border-purity-bean/20 px-3 py-1 text-xs hover:border-purity-bean disabled:opacity-50 dark:border-purity-paper/30 dark:text-purity-paper">
          Cancel
        </button>
      </div>
    </li>
  );
}

function NewLimitForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [form, setForm] = useState({
    key: '', label: '', unit: '',
    category: 'bioactive' as Limit['category'],
    direction: 'ceiling' as Limit['direction'],
    value: '', min: '', max: '',
    source: '', notes: '',
  });

  async function submit() {
    if (!form.key || !form.label || !form.source) {
      toast.push({ kind: 'error', message: 'Key, label, and source are required.' });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        key: form.key.trim(), label: form.label.trim(), unit: form.unit.trim(),
        category: form.category, direction: form.direction,
        source: form.source.trim(),
        notes: form.notes || null,
      };
      if (form.direction === 'range') {
        payload.min = form.min === '' ? null : Number(form.min);
        payload.max = form.max === '' ? null : Number(form.max);
      } else {
        payload.value = form.value === '' ? null : Number(form.value);
      }
      const res = await fetch('/api/admin/limits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Create failed');
      toast.push({ kind: 'success', message: 'Limit added.' });
      onCreated();
    } catch (e) {
      toast.push({ kind: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-purity-green/30 bg-purity-green/5 p-4 dark:border-purity-aqua/30 dark:bg-purity-aqua/10">
      <h2 className="font-serif text-base">New limit</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label='Key — DB column (e.g. "ota_ppb"), heavy_metals.<name>, or "raw:<analyte name>"'>
          <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="raw:Citric Acid" className={inputCls} />
        </Field>
        <Field label="Label (display name)">
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Unit">
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="ppb / mg/g / %" className={inputCls} />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Limit['category'] })} className={inputCls}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as Limit['direction'] })} className={inputCls}>
            <option value="ceiling">ceiling — over is bad</option>
            <option value="floor">floor — under is bad</option>
            <option value="range">range — outside is bad</option>
          </select>
        </Field>
        {form.direction !== 'range' ? (
          <Field label="Value">
            <input type="number" step="any" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={inputCls} />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min">
              <input type="number" step="any" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Max">
              <input type="number" step="any" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} className={inputCls} />
            </Field>
          </div>
        )}
        <Field label="Source" className="md:col-span-2">
          <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. CHC Health-Grade Green Standard" className={inputCls} />
        </Field>
        <Field label="Notes" className="md:col-span-2">
          <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={submit} disabled={busy}
          className="rounded bg-purity-green px-3 py-1.5 text-xs font-medium text-purity-cream hover:bg-purity-green/85 disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink">
          Add limit
        </button>
        <button onClick={onCancel} disabled={busy}
          className="rounded border border-purity-bean/20 px-3 py-1.5 text-xs hover:border-purity-bean disabled:opacity-50 dark:border-purity-paper/30 dark:text-purity-paper">
          Cancel
        </button>
      </div>
    </section>
  );
}

function DirectionBadge({ direction }: { direction: Limit['direction'] }) {
  const styles: Record<Limit['direction'], string> = {
    ceiling: 'bg-purity-rust/15 text-purity-rust',
    floor:   'bg-purity-gold/15 text-purity-bean dark:text-purity-paper',
    range:   'bg-purity-green/15 text-purity-green dark:bg-purity-aqua/15 dark:text-purity-aqua',
  };
  return <span className={`rounded-full px-2 py-0 text-[10px] uppercase tracking-wider ${styles[direction]}`}>{direction}</span>;
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-medium text-purity-muted dark:text-purity-mist">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls = 'w-full rounded border border-purity-bean/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-purity-green dark:border-purity-paper/20 dark:text-purity-paper';
