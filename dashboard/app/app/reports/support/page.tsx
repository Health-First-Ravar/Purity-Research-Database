import { cookies } from 'next/headers';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';
import { formatAnalyte, evaluate, getLimit, loadLimits, type Limit } from '@/lib/coa-limits';
import { CS_SCOPE } from '@/lib/coa-scope';

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

/** Per-analyte '<'/'>' qualifier recorded at import, keyed like the columns. */
function qualifiersOf(r: Row): Record<string, string> {
  return (r.value_qualifiers ?? {}) as Record<string, string>;
}

type Snap = {
  key: string;
  id: string;
  origin: string | null;
  latestDate: string | null;
  values: Record<string, number | null>;
  quals: Record<string, string | null>;
  valueDates: Record<string, string | null>;
};

/**
 * Compliance indicator for one cell.
 *
 * Thresholds come only from `coa_limits`. An analyte with no limit row must
 * say so — it must never render as a pass, because "no threshold on file" and
 * "measured and within threshold" are different claims.
 */
function LimitBadge({
  analyteKey, value, reported, limits,
}: { analyteKey: string; value: number | null; reported: string | null; limits: Limit[] }) {
  const limit = getLimit(analyteKey, limits);
  if (!limit) {
    return <span className="text-[10px] text-purity-muted/70 dark:text-purity-mist/70">no limit on file</span>;
  }
  const res = evaluate({ key: analyteKey, value, reported, limits });

  if (res.status === 'over' || res.status === 'under') {
    const word = res.status === 'over' ? 'OVER LIMIT' : 'BELOW MINIMUM';
    const bound = limit.direction === 'range'
      ? `${limit.min}–${limit.max}`
      : String(limit.value);
    return (
      <span
        className="rounded bg-purity-rust/12 px-1.5 py-0.5 text-[10px] font-semibold text-purity-rust"
        title={`${limit.label}: ${limit.direction} ${bound} ${limit.unit} — ${limit.source}`}
      >
        {word}
      </span>
    );
  }
  if (res.status === 'ok') {
    return (
      <span
        className="text-[10px] text-purity-green dark:text-purity-aqua"
        title={`${limit.label}: ${limit.direction} ${limit.direction === 'range' ? `${limit.min}–${limit.max}` : limit.value} ${limit.unit} — ${limit.source}`}
      >
        within limit
      </span>
    );
  }
  // no_value: either never tested, or a below-LOQ result against a floor,
  // where a non-detection cannot confirm the minimum is met.
  if (res.belowLoq) {
    return (
      <span className="text-[10px] text-purity-muted/70 dark:text-purity-mist/70" title={`Not detected, so the ${limit.value} ${limit.unit} minimum cannot be confirmed from this result.`}>
        not confirmable
      </span>
    );
  }
  return <span className="text-[10px] text-purity-muted/50 dark:text-purity-mist/50">not tested</span>;
}

export default async function SupportReportPage() {
  const supabase = supabaseServer(await cookies());
  const limits = await loadLimits();

  // This is the customer-service surface by definition, so it is pinned to the
  // allowlist unconditionally rather than by role — an editor previewing what a
  // rep sees should see exactly that. Competitor and unclassified rows never
  // enter the payload.
  const { data: rows, error } = await supabase
    .from('coas')
    .select('*')
    .eq('product_scope', CS_SCOPE)
    .is('retired_at', null)
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
    const quals: Record<string, string | null> = {};
    const valueDates: Record<string, string | null> = {};
    for (const col of ALL) {
      let v: number | null = null;
      let q: string | null = null;
      let d: string | null = null;
      for (const r of list) {
        const x = num(r[col.key]);
        const qual = qualifiersOf(r)[col.key] ?? null;
        // A below-LOQ result is information ("not detected"), so a row that
        // carries only a qualifier still counts as the latest reported result.
        if (x != null || qual) {
          v = x; q = qual; d = (r.report_date as string) ?? null; break;
        }
      }
      values[col.key] = v;
      quals[col.key] = q;
      valueDates[col.key] = d;
    }
    snaps.push({
      key: k,
      id: list[0].id,
      origin: (list[0].origin as string) ?? null,
      latestDate: (Object.values(valueDates).filter(Boolean).sort().pop() as string | undefined) ?? (list[0].report_date as string) ?? null,
      values,
      quals,
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
                  {ALL.map((c) => {
                    const d = formatAnalyte(s.values[c.key], s.quals[c.key], c.unit);
                    return (
                      <td
                        key={c.key}
                        className={`p-3 font-mono tabular-nums ${
                          d.kind === 'not_detected'
                            ? 'text-purity-green dark:text-purity-aqua'
                            : d.kind === 'not_tested'
                              ? 'italic text-purity-muted/70 dark:text-purity-mist/70'
                              : ''
                        }`}
                        title={
                          d.kind === 'not_detected'
                            ? `Not detected — below the lab's reporting limit of ${d.bound?.replace('<', '')} ${c.unit}${s.valueDates[c.key] ? ` (as of ${s.valueDates[c.key]})` : ''}`
                            : d.kind === 'not_tested'
                              ? 'This analyte was not measured on any COA for this product'
                              : s.valueDates[c.key] ? `as of ${s.valueDates[c.key]}` : undefined
                        }
                      >
                        <span className="block">{d.text}</span>
                        <span className="mt-0.5 block font-sans">
                          <LimitBadge
                            analyteKey={c.key}
                            value={s.values[c.key]}
                            reported={s.quals[c.key]}
                            limits={limits}
                          />
                        </span>
                      </td>
                    );
                  })}
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
      <p className="mb-3 max-w-2xl text-sm text-purity-muted dark:text-purity-mist">
        Most recent reported result for each blend and green coffee. Each cell is the latest
        COA that actually reported that analyte (hover a value for its test date). Click a product for its newest full COA.
      </p>
      <p className="mb-3 max-w-2xl rounded-md border border-purity-green/25 bg-purity-green/5 p-3 text-xs text-purity-bean dark:border-purity-aqua/25 dark:text-purity-paper">
        <strong>Shows current Purity products only.</strong> Lab reports we hold for
        other brands, and lots not yet matched to a product, are deliberately excluded.
        If a coffee you expect is missing, that is scope rather than an error — ask an
        editor to check the full reports view.
      </p>
      <div className="mb-6 flex max-w-2xl flex-wrap gap-x-5 gap-y-1 rounded-md border border-purity-bean/10 bg-purity-cream/50 p-3 text-xs dark:border-purity-paper/10 dark:bg-purity-shade/50">
        <span className="text-purity-muted dark:text-purity-mist">How to read these:</span>
        <span><span className="font-mono">1.20 ppb</span> — measured at that level</span>
        <span className="text-purity-green dark:text-purity-aqua">
          <span className="font-mono">Not detected</span> — none found, below the lab&rsquo;s reporting limit
        </span>
        <span className="italic text-purity-muted/70 dark:text-purity-mist/70">
          Not tested — no COA measured it. Not the same as zero.
        </span>
      </div>

      {error && <p className="text-purity-rust">Error: {error.message}</p>}
      {!error && snaps.length === 0 && (
        <p className="text-purity-muted dark:text-purity-mist">No COA rows found.</p>
      )}

      <Section title="Blends" items={blends} />
      <Section title="Green coffees" items={greens} />
    </div>
  );
}
