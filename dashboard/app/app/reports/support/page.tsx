import { cookies } from 'next/headers';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Customer-support snapshot: the MOST RECENT COA for each blend and each green
// coffee, showing a limited, customer-friendly panel of contaminants + nutrients.

const CONTAMINANTS: { key: string; label: string; unit: string }[] = [
  { key: 'ota_ppb',        label: 'Ochratoxin A', unit: 'ppb' },
  { key: 'aflatoxin_ppb',  label: 'Aflatoxin (total)', unit: 'ppb' },
  { key: 'acrylamide_ppb', label: 'Acrylamide', unit: 'ppb' },
];
const NUTRIENTS: { key: string; label: string; unit: string }[] = [
  { key: 'cga_mg_g',          label: 'Chlorogenic acids', unit: 'mg/g' },
  { key: 'melanoidins_mg_g',  label: 'Melanoidins', unit: 'mg/g' },
  { key: 'trigonelline_mg_g', label: 'Trigonelline', unit: 'mg/g' },
  { key: 'caffeine_pct',      label: 'Caffeine', unit: '%' },
];

type Row = Record<string, unknown> & {
  id: string;
  report_date: string | null;
  blend: string | null;
  coffee_name: string | null;
  origin: string | null;
  matrix: string | null;
  lab: string | null;
};

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
function fmt(v: number | null, unit: string): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const s = abs >= 100 ? v.toFixed(0) : abs >= 1 ? v.toFixed(2) : v.toPrecision(2);
  return `${s} ${unit}`;
}

export default async function SupportReportPage() {
  const supabase = supabaseServer(await cookies());

  const { data: rows, error } = await supabase
    .from('coas')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(2000);

  function groupKey(r: Row): string | null {
    if (r.blend) return `Blend · ${r.blend}`;
    const name = (r.coffee_name as string) || (r.origin as string);
    if (name) return `Green · ${name}`;
    return null;
  }

  const latest = new Map<string, Row>();
  for (const r of (rows ?? []) as Row[]) {
    const k = groupKey(r);
    if (!k) continue;
    const cur = latest.get(k);
    if (!cur) latest.set(k, r);
    else {
      const a = String(r.report_date ?? '');
      const b = String(cur.report_date ?? '');
      if (a.localeCompare(b) > 0) latest.set(k, r);
    }
  }

  const groups = Array.from(latest.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const blends = groups.filter(([k]) => k.startsWith('Blend'));
  const greens = groups.filter(([k]) => k.startsWith('Green'));

  function Section({ title, items }: { title: string; items: [string, Row][] }) {
    if (items.length === 0) return null;
    return (
      <div className="mb-8">
        <h2 className="mb-3 font-serif text-lg">{title}</h2>
        <div className="overflow-x-auto rounded-lg border border-purity-bean/10 bg-white shadow-sm dark:border-purity-paper/10 dark:bg-purity-shade dark:shadow-none">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-purity-bean/10 text-left text-xs text-purity-muted dark:border-purity-paper/10 dark:text-purity-mist">
                <th className="p-3">Product</th>
                <th className="p-3">Latest test</th>
                {CONTAMINANTS.map((c) => <th key={c.key} className="p-3">{c.label}</th>)}
                {NUTRIENTS.map((n) => <th key={n.key} className="p-3">{n.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map(([k, r]) => (
                <tr key={k} className="border-b border-purity-bean/5 hover:bg-purity-cream/40 dark:border-purity-paper/5 dark:hover:bg-purity-ink/40">
                  <td className="p-3">
                    <Link href={`/reports/${r.id}`} className="block">
                      {k.replace(/^(Blend|Green) · /, '')}
                      {r.origin && !k.includes(r.origin as string) ? (
                        <span className="text-purity-muted dark:text-purity-mist"> · {r.origin as string}</span>
                      ) : null}
                    </Link>
                  </td>
                  <td className="p-3 text-purity-muted dark:text-purity-mist">{(r.report_date as string) ?? '—'}</td>
                  {CONTAMINANTS.map((c) => <td key={c.key} className="p-3 font-mono tabular-nums">{fmt(num(r[c.key]), c.unit)}</td>)}
                  {NUTRIENTS.map((n) => <td key={n.key} className="p-3 font-mono tabular-nums">{fmt(num(r[n.key]), n.unit)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl">Customer-support snapshot</h1>
        <Link href="/reports" className="text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">
          ← Full reports
        </Link>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-purity-muted dark:text-purity-mist">
        The most recent certificate of analysis for each blend and green coffee, with a customer-friendly
        contaminant and nutrient panel. Click a product to open its full COA.
      </p>

      {error && <p className="text-purity-rust">Error: {error.message}</p>}
      {!error && groups.length === 0 && (
        <p className="text-purity-muted dark:text-purity-mist">No COA rows found.</p>
      )}

      <Section title="Blends" items={blends} />
      <Section title="Green coffees" items={greens} />
    </div>
  );
}
