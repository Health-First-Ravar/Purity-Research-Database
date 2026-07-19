'use client';

import { formatAnalyteCsv } from '@/lib/coa-limits';

type Row = Record<string, unknown>;

export function CsvDownload({ rows, analyteKey, analyteLabel }: { rows: Row[]; analyteKey?: string | null; analyteLabel?: string | null }) {
  function download() {
    // When no analyte is selected, export the coffee/origin/lot/blend/date/lab
    // columns only, without an analyte value column.
    const hasAnalyte = !!analyteKey;
    const headers = ['report_date', 'blend', 'coffee_name', 'lot_number', 'origin', ...(hasAnalyte ? [analyteKey!] : []), 'lab'];
    const headerLabels = ['Date', 'Blend', 'Coffee', 'Lot', 'Origin', ...(hasAnalyte ? [analyteLabel ?? analyteKey!] : []), 'Lab'];
    const lines = [headerLabels.join(',')];
    for (const r of rows) {
      lines.push(headers.map((h) => {
        // The analyte column must never export a bare number when the lab
        // reported a below-LOQ result — that states a detection that never
        // happened. Everything else exports verbatim.
        const val =
          h === analyteKey
            ? formatAnalyteCsv(
                typeof r[analyteKey] === 'number' ? (r[analyteKey] as number) : null,
                typeof r.__reported === 'string' ? r.__reported : null,
              )
            : r[h] == null ? '' : String(r[h]);
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `purity-coa-${hasAnalyte ? analyteKey : 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="rounded-md border border-purity-bean/20 px-3 py-1.5 text-xs text-purity-muted transition hover:border-purity-green hover:text-purity-green dark:border-purity-paper/20 dark:text-purity-mist dark:hover:border-purity-aqua dark:hover:text-purity-aqua"
    >
      Download CSV
    </button>
  );
}
