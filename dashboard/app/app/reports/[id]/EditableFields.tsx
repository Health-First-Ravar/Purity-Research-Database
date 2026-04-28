'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CoaEditableFields({
  id,
  origin: initialOrigin,
  region: initialRegion,
}: {
  id: string;
  origin: string;
  region: string;
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState(initialOrigin);
  const [region, setRegion] = useState(initialRegion);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/reports/coa/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: origin || null, region: region || null }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMsg(json.error ?? 'save failed');
      return;
    }
    setMsg('saved');
    router.refresh();
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-purity-muted dark:text-purity-mist">Origin</span>
        <input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-purity-muted dark:text-purity-mist">Region</span>
        <input
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
        />
      </label>
      <div className="md:col-span-2 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-purity-bean px-4 py-1.5 text-xs font-medium text-purity-cream disabled:opacity-50 dark:bg-purity-aqua dark:text-purity-ink"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="text-xs text-purity-muted dark:text-purity-mist">{msg}</span>}
      </div>
    </div>
  );
}
