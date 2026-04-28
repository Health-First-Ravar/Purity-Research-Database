import { cookies } from 'next/headers';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';
import { AnalyteChart } from './_components/AnalyteChart';
import { AnalyteLimitsPanel } from './_components/AnalyteLimitsPanel';
import { CsvDownload } from './_components/CsvDownload';
import { evaluate, fmtValue, statusStyle, loadLimits, getLimit } from '@/lib/coa-limits';
import { isAdmin } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

type Search = {
  blend?: string;
  coffee?: string;
  analyte?: string;
  from?: string;
  to?: string;
  origin?: string;
  lab?: string;
  has_data?: string; // '1' to filter to rows where the chosen analyte is non-null
};

const TOP_ANALYTES: { key: string; label: string }[] = [
  { key: 'ota_ppb',           label: 'Ochratoxin A (ppb)' },
  { key: 'aflatoxin_ppb',     label: 'Aflatoxin (ppb)' },
  { key: 'acrylamide_ppb',    label: 'Acrylamide (ppb)' },
  { key: 'cga_mg_g',          label: 'CGAs (mg/g)' },
  { key: 'melanoidins_mg_g',  label: 'Melanoidins (mg/g)' },
  { key: 'trigonelline_mg_g', label: 'Trigonelline (mg/g)' },
  { key: 'caffeine_pct',      label: 'Caffeine (%)' },
  { key: 'moisture_pct',      label: 'Moisture (%)' },
  { key: 'water_activity',    label: 'Water activity' },
];

type RawAnalyte = { value: number | null; unit: string | null; panel: string | null };

function readAnalyte(row: Record<string, unknown>, key: string): number | null {
  if (key.startsWith('raw:')) {
    const name = key.slice(4);
    const raw = (row.raw_values ?? {}) as Record<string, RawAnalyte | undefined>;
    const v = raw[name]?.value;
    return typeof v === 'number' ? v : null;
  }
  const v = row[key];
  return typeof v === 'number' ? v : null;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;

  const supabase = supabaseServer(await cookies());

  // Admin gets to see / edit limits; everyone gets the colored cells.
  const { data: auth } = await supabase.auth.getUser();
  let isAdminUser = false;
  if (auth.user) {
    const { data: p } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    isAdminUser = isAdmin(p?.role);
  }
  const limits = await loadLimits();

  let q = supabase
    .from('coas')
    .select('*')
    .order('report_date', { ascending: true })
    .limit(500);
  if (params.blend)  q = q.eq('blend', params.blend);
  if (params.coffee) q = q.ilike('coffee_name', `%${params.coffee}%`);
  if (params.origin) q = q.eq('origin', params.origin);
  if (params.lab)    q = q.eq('lab', params.lab);
  if (params.from)   q = q.gte('report_date', params.from);
  if (params.to)     q = q.lte('report_date', params.to);

  const { data: rows, error } = await q;

  // Build origin + lab option lists AND year coverage from a separate
  // (unfiltered) probe so the controls stay populated even when filters
  // narrow `rows` to nothing.
  const { data: optRows } = await supabase
    .from('coas')
    .select('origin, lab, report_date')
    .limit(2000);
  const originSet = new Set<string>();
  const labSet = new Set<string>();
  const yearCounts = new Map<string, number>();
  let undatedCount = 0;
  for (const r of optRows ?? []) {
    if (r.origin) originSet.add(r.origin as string);
    if (r.lab) labSet.add(r.lab as string);
    const d = r.report_date as string | null;
    if (d && /^\d{4}/.test(d)) {
      const yr = d.slice(0, 4);
      yearCounts.set(yr, (yearCounts.get(yr) ?? 0) + 1);
    } else {
      undatedCount++;
    }
  }
  const originOptions = Array.from(originSet).sort();
  const labOptions = Array.from(labSet).sort();
  const yearList = Array.from(yearCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  // Decide which year (if any) is currently active — when from/to span exactly
  // one full calendar year, light up that pill.
  const activeYear = (() => {
    if (!params.from || !params.to) return null;
    const f = params.from, t = params.to;
    if (f.length === 10 && f.endsWith('-01-01') && t.length === 10 && t.endsWith('-12-31') && f.slice(0, 4) === t.slice(0, 4)) {
      return f.slice(0, 4);
    }
    return null;
  })();
  const isAllDates = !params.from && !params.to;

  // Build a querystring helper that preserves all OTHER filters when toggling
  // a year pill on/off.
  function withYear(year: string | null): string {
    const sp = new URLSearchParams();
    if (params.blend)    sp.set('blend', params.blend);
    if (params.origin)   sp.set('origin', params.origin);
    if (params.lab)      sp.set('lab', params.lab);
    if (params.coffee)   sp.set('coffee', params.coffee);
    if (params.analyte)  sp.set('analyte', params.analyte);
    if (params.has_data) sp.set('has_data', params.has_data);
    if (year) {
      sp.set('from', `${year}-01-01`);
      sp.set('to', `${year}-12-31`);
    }
    const qs = sp.toString();
    return qs ? `/reports?${qs}` : '/reports';
  }

  // Discover distinct raw analytes across the loaded rows
  const rawSet = new Map<string, { unit: string | null; panel: string | null }>();
  for (const r of rows ?? []) {
    const raw = (r.raw_values ?? {}) as Record<string, RawAnalyte | undefined>;
    for (const [name, v] of Object.entries(raw)) {
      if (!rawSet.has(name) && v) rawSet.set(name, { unit: v.unit ?? null, panel: v.panel ?? null });
    }
  }
  const rawAnalytes = Array.from(rawSet.entries())
    .map(([name, meta]) => ({
      key: `raw:${name}`,
      label: meta.unit ? `${name} (${meta.unit})` : name,
      panel: meta.panel ?? '',
    }))
    .sort((a, b) => a.panel.localeCompare(b.panel) || a.label.localeCompare(b.label));

  const allOptions = [
    { group: 'Headline', items: TOP_ANALYTES },
    { group: 'All analytes', items: rawAnalytes.map(({ key, label }) => ({ key, label })) },
  ];

  const flatOptions = [...TOP_ANALYTES, ...rawAnalytes];
  const analyte = flatOptions.find((a) => a.key === params.analyte) ?? TOP_ANALYTES[0];
  const matchingLimit = getLimit(analyte.key, limits) ?? null;

  let chartRows = (rows ?? []).map((r) => ({
    ...r,
    __value: readAnalyte(r as Record<string, unknown>, analyte.key),
  }));
  // "Has data for selected analyte" — drop rows where the chosen analyte is null/undefined.
  if (params.has_data === '1') {
    chartRows = chartRows.filter((r) => r.__value != null);
  }
  const hasData = !error && chartRows.filter((r) => r.__value != null && r.report_date).length >= 2;
  const totalCount = rows?.length ?? 0;
  const visibleCount = chartRows.length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl">Reports</h1>
        <div className="flex items-center gap-4">
          {isAdminUser && (
            <Link
              href="/reports/limits"
              className="text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua"
            >
              Limits →
            </Link>
          )}
          <Link
            href="/reports/mappings"
            className="text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua"
          >
            Mapping rules →
          </Link>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-purity-bean/10 bg-white p-3 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
        <span className="mr-1 text-xs uppercase tracking-wider text-purity-muted dark:text-purity-mist">Dates</span>
        <Link
          href={withYear(null)}
          className={
            'rounded-full border px-2.5 py-0.5 text-[11px] transition ' +
            (isAllDates
              ? 'border-purity-bean bg-purity-bean text-purity-cream dark:border-purity-aqua dark:bg-purity-aqua dark:text-purity-ink'
              : 'border-purity-bean/20 text-purity-bean hover:bg-purity-cream dark:border-purity-paper/20 dark:text-purity-paper dark:hover:bg-purity-ink/40')
          }
        >
          All ({(optRows ?? []).length})
        </Link>
        {yearList.map(([year, count]) => {
          const active = activeYear === year;
          return (
            <Link
              key={year}
              href={active ? withYear(null) : withYear(year)}
              className={
                'rounded-full border px-2.5 py-0.5 text-[11px] transition ' +
                (active
                  ? 'border-purity-bean bg-purity-bean text-purity-cream dark:border-purity-aqua dark:bg-purity-aqua dark:text-purity-ink'
                  : 'border-purity-bean/20 text-purity-bean hover:bg-purity-cream dark:border-purity-paper/20 dark:text-purity-paper dark:hover:bg-purity-ink/40')
              }
            >
              {year} <span className="text-purity-muted dark:text-purity-mist">{count}</span>
            </Link>
          );
        })}
        {undatedCount > 0 && (
          <span
            className="rounded-full border border-purity-gold/30 bg-purity-gold/10 px-2.5 py-0.5 text-[11px] text-purity-muted dark:text-purity-mist"
            title="COAs without a parsed report_date"
          >
            no date · {undatedCount}
          </span>
        )}
      </div>
      <form className="mb-6 grid gap-3 rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade md:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-purity-muted dark:text-purity-mist">Blend</span>
          <select name="blend" defaultValue={params.blend ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper">
            <option value="">(any)</option>
            {['PROTECT', 'FLOW', 'EASE', 'CALM'].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-purity-muted dark:text-purity-mist">Origin</span>
          <select name="origin" defaultValue={params.origin ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper">
            <option value="">(any)</option>
            {originOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-purity-muted dark:text-purity-mist">Lab</span>
          <select name="lab" defaultValue={params.lab ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper">
            <option value="">(any)</option>
            {labOptions.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-purity-muted dark:text-purity-mist">Coffee (contains)</span>
          <input name="coffee" defaultValue={params.coffee ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper dark:placeholder:text-purity-mist/70" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-purity-muted dark:text-purity-mist">Analyte</span>
          <select name="analyte" defaultValue={analyte.key} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper">
            {allOptions.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-purity-muted dark:text-purity-mist">From</span>
          <input type="date" name="from" defaultValue={params.from ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-purity-muted dark:text-purity-mist">To</span>
          <input type="date" name="to" defaultValue={params.to ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-ink dark:text-purity-paper" />
        </label>
        <label className="flex items-end gap-2 pb-1">
          <input
            type="checkbox"
            name="has_data"
            value="1"
            defaultChecked={params.has_data === '1'}
            className="h-4 w-4 rounded border-purity-bean/30 dark:border-purity-paper/30"
          />
          <span className="text-xs text-purity-muted dark:text-purity-mist">
            Only rows with data for this analyte
          </span>
        </label>
        <div className="md:col-span-4 flex flex-wrap items-center gap-3">
          <button className="rounded-md bg-purity-bean px-4 py-1.5 text-xs font-medium text-purity-cream dark:bg-purity-aqua dark:text-purity-ink">
            Apply
          </button>
          <Link
            href="/reports"
            className="text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua"
          >
            Clear filters
          </Link>
          <span className="text-xs text-purity-muted dark:text-purity-mist">
            {visibleCount} of {totalCount} matching
          </span>
          {chartRows.length > 0 && (
            <CsvDownload
              rows={chartRows as Record<string, unknown>[]}
              analyteKey="__value"
              analyteLabel={analyte.label}
            />
          )}
        </div>
      </form>

      {hasData ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AnalyteChart
              rows={chartRows as Parameters<typeof AnalyteChart>[0]['rows']}
              analyteKey="__value"
              analyteLabel={analyte.label}
              limit={matchingLimit}
            />
          </div>
          <div className="lg:col-span-1">
            <AnalyteLimitsPanel
              analyteKey={analyte.key}
              analyteLabel={analyte.label}
              limit={matchingLimit}
            />
          </div>
        </div>
      ) : visibleCount > 0 ? (
        <p className="mb-6 text-sm text-purity-muted dark:text-purity-mist">
          Chart needs at least 2 data points for this analyte. Try a broader filter, another analyte,
          or untick &quot;Only rows with data for this analyte&quot; to see all matching rows.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-purity-bean/10 bg-white shadow-sm dark:border-purity-paper/10 dark:bg-purity-shade dark:shadow-none">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-purity-bean/10 text-left text-xs text-purity-muted dark:border-purity-paper/10 dark:text-purity-mist">
              <th className="p-3">Date</th>
              <th className="p-3">Blend / Coffee</th>
              <th className="p-3">Lot</th>
              <th className="p-3">Origin</th>
              <th className="p-3">Region</th>
              <th className="p-3">{analyte.label}</th>
              <th className="p-3">Lab</th>
            </tr>
          </thead>
          <tbody>
            {error && <tr><td colSpan={7} className="p-4 text-purity-rust">Error: {error.message}</td></tr>}
            {chartRows.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="p-4 text-purity-muted dark:text-purity-mist">
                  {totalCount === 0
                    ? 'No COA rows match. Import COAs via scripts/import-coas.ts.'
                    : `No rows match the current filters. ${totalCount} hidden — try clearing filters.`}
                </td>
              </tr>
            )}
            {chartRows.slice().sort((a, b) => String(b.report_date ?? '').localeCompare(String(a.report_date ?? ''))).map((r) => {
              // Limit-aware styling for the analyte value cell.
              // For 'raw:'-prefixed analyte keys, evaluate against raw_values qualifier; for headlines, against value_qualifiers map.
              const reported = (() => {
                if (analyte.key.startsWith('raw:')) {
                  const name = analyte.key.slice(4);
                  const raw = (r.raw_values ?? {}) as Record<string, { as_reported?: string | null }>;
                  return raw[name]?.as_reported ?? null;
                }
                const qmap = (r.value_qualifiers ?? {}) as Record<string, string>;
                return qmap[analyte.key] ?? null;
              })();
              const cellEval = evaluate({ key: analyte.key, value: typeof r.__value === 'number' ? r.__value : null, reported, limits });
              const cellClass = statusStyle(cellEval.status);
              const cellDisplay = r.__value == null && !reported ? '—' : fmtValue(typeof r.__value === 'number' ? r.__value : null, reported);
              return (
                <tr
                  key={r.id as string}
                  className="border-b border-purity-bean/5 transition hover:bg-purity-cream/40 dark:border-purity-paper/5 dark:hover:bg-purity-ink/40"
                >
                  <td className="p-3"><Link href={`/reports/${r.id}`} className="block">{(r.report_date as string) ?? '—'}</Link></td>
                  <td className="p-3"><Link href={`/reports/${r.id}`} className="block">{(r.blend as string) ?? '—'} {r.coffee_name ? <span className="text-purity-muted dark:text-purity-mist">· {r.coffee_name as string}</span> : null}</Link></td>
                  <td className="p-3 font-mono text-xs"><Link href={`/reports/${r.id}`} className="block">{(r.lot_number as string) ?? '—'}</Link></td>
                  <td className="p-3"><Link href={`/reports/${r.id}`} className="block">{(r.origin as string) ?? '—'}</Link></td>
                  <td className="p-3"><Link href={`/reports/${r.id}`} className="block">{(r.region as string) ?? '—'}</Link></td>
                  <td className={`p-3 font-mono ${cellClass}`}><Link href={`/reports/${r.id}`} className="block">{cellDisplay}</Link></td>
                  <td className="p-3 text-purity-muted dark:text-purity-mist"><Link href={`/reports/${r.id}`} className="block">{(r.lab as string) ?? '—'}</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
