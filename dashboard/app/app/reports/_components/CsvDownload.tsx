'use client';

type Row = Record<string, unknown>;

export function CsvDownload({ rows, analyteKey, analyteLabel }: { rows: Row[]; analyteKey: string; analyteLabel: string }) {
  function download() {
    const headers = ['report_date', 'blend', 'coffee_name', 'lot_number', 'origin', analyteKey, 'lab'];
    const headerLabels = ['Date', 'Blend', 'Coffee', 'Lot', 'Origin', analyteLabel, 'Lab'];
    const lines = [headerLabels.join(',')];
    for (const r of rows) {
      lines.push(headers.map((h) => {
        const val = r[h] == null ? '' : String(r[h]);
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `purity-coa-${analyteKey}-${new Date().toISOString().slice(0, 10)}.csv`;
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
