import { cookies } from 'next/headers';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Customer-support snapshot: per blend and per green coffee, the most recent
// NON-NULL value for each analyte across that product's COAs (so a narrow or
// empty latest report doesn't blank the panel).

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
const ALL = [...CONTAMINANTS, ...NUTRIENTS];

type Row = Record<string, unknown> & {
  id: string;
  report_date: string | null;
  blend: string | null;
  coffee_name: string | null;
  origin: string | null;
  matrix: string | null;
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

type Snap = {
  key: string;
  id: string;
  origin: string | null;
  latestDate: string | null;
  values: Record<string, number | null>;
  valueDates: Record<string, string | null>;
};

export default async function SupportReportPage() {
  const supabase = supabaseServer(await cookies());

  const { data: rows, error } = await supabase
    .from('coas')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(5000);

  function groupKey(r: Row): string | null {
    if (r.blend) return `Blend · ${r.blend}`;
    const name = (r.coffee_name as string) || (r.origin as string);
    if (name) return `Green · ${name}`;
    return null;
  }

  const byGroup = new Map<string, Row[]>();
  for (const r of (rows ?? []) as Row[]) {
    const k = groupKey(r);
    if (!k) continue;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(r);
  }

  const snaps: Snap[] = [];
  for (const [k, list] of byGroup) {
    list.sort((a, b) => String(b.report_date ?? '').localeCompare(String(a.report_date ?? '')));
    const values: Record<string, number | null> = {};
    const valueDates: Record<string, string | null> = {};
    for (const col of ALL) {
      let v: number | null = null;
      let d: string | null = null;
      for (const r of list) {
        const x = num(r[col.key]);
        if (x != null) { v = x; d = (r.report_date as string) ?? null; break; }
      }
      values[col.key] = v;
      valueDates[col.key] = d;
    }
    snaps.push({
      key: k,
      id: list[0].id,
      origin: (list[0].origin as string) ?? null,
      latestDate: (Object.values(valueDates).filter(Boolean).sort().pop() as string | undefined) ?? (list[0].report_date as string) ?? null,
      values,
      valueDates,
    });
  }
  snaps.sort((a, b) => a.key.localeCompare(b.key));
  const blends = snaps.filter((s) => s.key.startsWith('Blend'));
  const greens = snaps.filter((s) => s.key.startsWith('Green'));

  function Section({ title, items }: { title: string; items: Snap[] }) {
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
                {ALL.map((c) => <th key={c.key} className="p-3">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.key} className="border-b border-purity-bean/5 hover:bg-purity-cream/40 dark:border-purity-paper/5 dark:hover:bg-purity-ink/40">
                  <td className="p-3">
                    <Link href={`/reports/${s.id}`} className="block">
                      {s.key.replace(/^(Blend|Green) · /, '')}
                      {s.origin && !s.key.includes(s.origin) ? (
                        <span className="text-purity-muted dark:text-purity-mist"> · {s.origin}</span>
                      ) : null}
                    </Link>
                  </td>
                  <td className="p-3 text-purity-muted dark:text-purity-mist">{s.latestDate ?? '—'}</td>
                  {ALL.map((c) => (
                    <td key={c.key} className="p-3 font-mono tabular-nums" title={s.valueDates[c.key] ? `as of ${s.valueDates[c.key]}` : undefined}>
                      {fmt(s.values[c.key], c.unit)}
                    </td>
                  ))}
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
        Most recent measured value for each blend and green coffee. Each cell is the latest
        COA that actually reported that analyte (hover a value for its test date). Click a product for its newest full COA.
      </p>

      {error && <p className="text-purity-rust">Error: {error.message}</p>}
      {!error && snaps.length === 0 && (
        <p className="text-purity-muted dark:text-purity-mist">No COA rows found.</p>
      )}

      <Section title="Blends" items={blends} />
      <Section title="Green coffees" items={greens} />
    </div>
  );
}
