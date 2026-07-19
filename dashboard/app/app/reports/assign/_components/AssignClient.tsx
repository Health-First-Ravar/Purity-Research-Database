'use client';

import { useState } from 'react';

export type RecordView = {
  id: string;
  reportNumber: string | null;
  coffeeName: string | null;
  lotNumber: string | null;
  origin: string | null;
  matrix: string | null;
  lab: string | null;
  reportDate: string | null;
  pdfFilename: string | null;
  suggestedBlend: string | null;
  suggestionEvidence: string[];
  suggestionStrength: string;
};
export type BucketView = { name: string; records: RecordView[] };

type Preview = {
  would_update: number;
  becoming_cs_visible: number;
  becoming_cs_visible_examples: { report_number: string | null; coffee_name: string | null }[];
  already_assigned_will_be_overwritten: number;
  blend: string | null;
  product_scope: string;
};

export function AssignClient({ buckets, blendKeys }: { buckets: BucketView[]; blendKeys: string[] }) {
  const [openBucket, setOpenBucket] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [blend, setBlend] = useState<string>('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);

  async function call(body: Record<string, unknown>) {
    const res = await fetch('/api/reports/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, json: await res.json() };
  }

  // Preview always runs against the API's dry run, so what is confirmed is
  // computed by the same code that applies it.
  async function doPreview() {
    if (!selectedIds.length || !blend) return;
    setBusy(true); setResult(null);
    const { ok, json } = await call({ action: 'assign', ids: selectedIds, blend, product_scope: 'purity', dry_run: true });
    setBusy(false);
    if (!ok) { setResult(`Error: ${json.error}`); return; }
    setPreview(json as Preview);
  }

  async function doApply() {
    if (!preview || !selectedIds.length || !blend) return;
    setBusy(true);
    const { ok, json } = await call({ action: 'assign', ids: selectedIds, blend, product_scope: 'purity', dry_run: false });
    setBusy(false);
    setPreview(null);
    setResult(ok
      ? `Assigned ${json.assigned} record(s) to ${blend}. ${json.became_cs_visible} became visible to customer service. Reversible from this page.`
      : `Error: ${json.error}`);
    if (ok) setSelected({});
  }

  async function doSkip() {
    if (!selectedIds.length) return;
    setBusy(true);
    const { ok, json } = await call({ action: 'skip', ids: selectedIds, dry_run: false });
    setBusy(false);
    setResult(ok ? `Recorded ${json.skipped} skip(s) — logged as reviewed, not assigned.` : `Error: ${json.error}`);
    if (ok) setSelected({});
  }

  async function doRevert() {
    if (!selectedIds.length) return;
    setBusy(true);
    const { ok, json } = await call({ action: 'revert', ids: selectedIds, dry_run: false });
    setBusy(false);
    setResult(ok ? `Reverted ${json.reverted} record(s) to their previous product and scope.` : `Error: ${json.error}`);
    if (ok) setSelected({});
  }

  function toggleAllInBucket(b: BucketView, on: boolean) {
    const next = { ...selected };
    for (const r of b.records) next[r.id] = on;
    setSelected(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {result ? (
        <div className="rounded-md border border-purity-green/30 bg-purity-green/5 p-3 text-sm dark:border-purity-aqua/30">
          {result}
        </div>
      ) : null}

      {/* Action bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-purity-bean/15 bg-white/95 p-3 text-sm backdrop-blur dark:border-purity-paper/15 dark:bg-purity-shade/95">
        <span className="font-semibold">{selectedIds.length} selected</span>
        <select
          value={blend}
          onChange={(e) => { setBlend(e.target.value); setPreview(null); }}
          className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper"
        >
          <option value="">Choose product…</option>
          {blendKeys.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <button type="button" disabled={busy || !selectedIds.length || !blend} onClick={doPreview}
          className="rounded-md border border-purity-bean/25 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-purity-paper/25">
          Preview
        </button>
        <button type="button" disabled={busy || !selectedIds.length} onClick={doSkip}
          className="rounded-md border border-purity-bean/25 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-purity-paper/25">
          Skip (record as reviewed)
        </button>
        <button type="button" disabled={busy || !selectedIds.length} onClick={doRevert}
          className="rounded-md border border-purity-bean/25 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-purity-paper/25">
          Revert
        </button>
      </div>

      {/* Confirmation with scope consequence stated before anything is written */}
      {preview ? (
        <div className="rounded-lg border border-purity-rust/40 bg-purity-rust/5 p-4 text-sm">
          <p className="font-semibold text-purity-rust">Confirm before applying</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            <li>{preview.would_update} record(s) will be set to <strong>{preview.blend}</strong>.</li>
            <li>
              <strong>{preview.becoming_cs_visible} will become visible to customer service.</strong>{' '}
              A rep will be able to read these lab values and quote them.
            </li>
            {preview.becoming_cs_visible_examples.length ? (
              <li className="font-mono">
                e.g. {preview.becoming_cs_visible_examples.map((e) => e.report_number ?? e.coffee_name).join(', ')}
              </li>
            ) : null}
            {preview.already_assigned_will_be_overwritten > 0 ? (
              <li className="text-purity-rust">
                {preview.already_assigned_will_be_overwritten} already carry a manual assignment and
                will be overwritten.
              </li>
            ) : null}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={doApply}
              className="rounded-md bg-purity-rust px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              Apply
            </button>
            <button type="button" onClick={() => setPreview(null)}
              className="rounded-md border border-purity-bean/25 px-3 py-1.5 text-xs dark:border-purity-paper/25">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Buckets */}
      {buckets.map((b) => {
        const open = openBucket === b.name;
        const sel = b.records.filter((r) => selected[r.id]).length;
        return (
          <div key={b.name} className="rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
            <button type="button" onClick={() => setOpenBucket(open ? null : b.name)}
              className="flex w-full items-center justify-between gap-3 p-3 text-left">
              <span>
                <span className="font-semibold">{b.name}</span>
                <span className="ml-2 text-xs text-purity-muted dark:text-purity-mist">
                  {b.records.length} record{b.records.length === 1 ? '' : 's'}
                  {sel ? ` · ${sel} selected` : ''}
                </span>
              </span>
              <span className="text-xs text-purity-muted">{open ? '▲' : '▼'}</span>
            </button>

            {open ? (
              <div className="border-t border-purity-bean/10 p-3 dark:border-purity-paper/10">
                <div className="mb-2 flex gap-2 text-xs">
                  <button type="button" onClick={() => toggleAllInBucket(b, true)} className="underline">Select all {b.records.length}</button>
                  <button type="button" onClick={() => toggleAllInBucket(b, false)} className="underline">Clear</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-xs">
                    <thead>
                      <tr className="border-b border-purity-bean/10 text-left text-purity-muted dark:border-purity-paper/10 dark:text-purity-mist">
                        <th className="p-2"></th>
                        <th className="p-2">Sample name</th>
                        <th className="p-2">Report</th>
                        <th className="p-2">Lot</th>
                        <th className="p-2">Origin</th>
                        <th className="p-2">Matrix</th>
                        <th className="p-2">Tested</th>
                        <th className="p-2">Source file</th>
                        <th className="p-2">Suggestion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.records.map((r) => (
                        <tr key={r.id} className="border-b border-purity-bean/5 dark:border-purity-paper/5">
                          <td className="p-2">
                            <input type="checkbox" checked={!!selected[r.id]}
                              onChange={(e) => setSelected({ ...selected, [r.id]: e.target.checked })} />
                          </td>
                          <td className="p-2">{r.coffeeName ?? <span className="italic text-purity-muted">no sample name</span>}</td>
                          <td className="p-2 font-mono">{r.reportNumber ?? '—'}</td>
                          <td className="p-2 font-mono">{r.lotNumber ?? '—'}</td>
                          <td className="p-2">{r.origin ?? '—'}</td>
                          <td className="p-2">{r.matrix ?? '—'}</td>
                          <td className="p-2 font-mono">{r.reportDate ?? '—'}</td>
                          <td className="p-2 font-mono text-[10px]">{r.pdfFilename ?? '—'}</td>
                          <td className="p-2">
                            {r.suggestedBlend ? (
                              <span title={r.suggestionEvidence.join(' · ')}>
                                <span className="rounded bg-purity-green/12 px-1.5 py-0.5 font-semibold text-purity-green dark:text-purity-aqua">
                                  suggests {r.suggestedBlend}
                                </span>
                                <span className="mt-0.5 block text-[10px] text-purity-muted dark:text-purity-mist">
                                  {r.suggestionEvidence.join(' · ')}
                                </span>
                              </span>
                            ) : (
                              <span className="text-purity-muted/70">no evidence — open the PDF</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
