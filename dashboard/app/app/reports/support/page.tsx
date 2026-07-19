import { Fragment } from 'react';
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

/**
 * One COA lot. Never an aggregate.
 *
 * This page previously rolled every lot of a product into a single row, taking
 * the latest non-null value per analyte INDEPENDENTLY. That produced two
 * distinct failures:
 *
 *   Hiding  — APONTE PINK BAG DECAF has two lots at OTA 7.3 and 6.0; the row
 *             showed 7.3 and the 6.0 lot was invisible.
 *   Chimera — because each analyte was sourced separately, one row could mix
 *             lots. FLOW merged three: acrylamide from a 2025-08-26 lot, CGA
 *             from 2022-03-02, caffeine from 2025-08-27. That row described no
 *             lot that has ever existed.
 *
 * A COA is lot-specific. Annotating the roll-up ("latest of 11 lots") would fix
 * the hiding but not the chimera — a merged row is not the latest of anything.
 * So every row here is one lot, with its own report number and date.
 */
type LotRow = {
  groupKey: string;
  id: string;
  reportNumber: string | null;
  lotNumber: string | null;
  reportDate: string | null;
  origin: string | null;
  values: Record<string, number | null>;
  quals: Record<string, string | null>;
};

/**
 * Compliance indicator for one cell.
 *
 * Thresholds come only from `coa_limits`. An analyte with no limit row must
 * say so — it must never render as a pass, because "no threshold on file" and
 * "measured and within threshold" are different claims.
 */
function LimitBadge({
  analyteKey, value, reported, limits, verified,
}: { analyteKey: string; value: number | null; reported: string | null; limits: Limit[]; verified: boolean }) {
  const limit = getLimit(analyteKey, limits);
  if (!limit) {
    return <span className="text-[10px] text-purity-muted/70 dark:text-purity-mist/70">no limit on file</span>;
  }
  const res = evaluate({ key: analyteKey, value, reported, limits });
  // A pass/fail marking derived from fallback thresholds is not a compliance
  // result. Mark it rather than asserting it.
  const mark = (t: string) => (verified ? t : `${t} (unverified)`);

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
        {mark(word)}
      </span>
    );
  }
  if (res.status === 'ok') {
    return (
      <span
        className="text-[10px] text-purity-green dark:text-purity-aqua"
        title={`${limit.label}: ${limit.direction} ${limit.direction === 'range' ? `${limit.min}–${limit.max}` : limit.value} ${limit.unit} — ${limit.source}`}
      >
        {mark('within limit')}
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
  const { limits, verified: limitsVerified } = await loadLimits();

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

  // One row per lot. No cross-lot aggregation of any kind.
  const lotRows: LotRow[] = [];
  for (const [k, list] of byGroup) {
    list.sort((a, b) => String(b.report_date ?? '').localeCompare(String(a.report_date ?? '')));
    for (const r of list) {
      const values: Record<string, number | null> = {};
      const quals: Record<string, string | null> = {};
      for (const col of ALL) {
        values[col.key] = num(r[col.key]);
        quals[col.key] = qualifiersOf(r)[col.key] ?? null;
      }
      lotRows.push({
        groupKey: k,
        id: r.id,
        reportNumber: (r.report_number as string) ?? null,
        lotNumber: (r.lot_number as string) ?? null,
        reportDate: (r.report_date as string) ?? null,
        origin: (r.origin as string) ?? null,
        values,
        quals,
      });
    }
  }
  // Group -> lots, newest first, groups alphabetical.
  const byProduct = new Map<string, LotRow[]>();
  for (const lr of lotRows) {
    if (!byProduct.has(lr.groupKey)) byProduct.set(lr.groupKey, []);
    byProduct.get(lr.groupKey)!.push(lr);
  }
  const products = [...byProduct.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const blends = products.filter(([k]) => k.startsWith('Blend'));
  const greens = products.filter(([k]) => k.startsWith('Green'));

  // Whether any cell on this page renders an out-of-limit badge. The guidance
  // note below is shown only when there is something to route, so it stays
  // meaningful rather than becoming permanent furniture a rep stops reading.
  const hasOutOfLimit = lotRows.some((lr) =>
    ALL.some((col) => {
      const st = evaluate({ key: col.key, value: lr.values[col.key], reported: lr.quals[col.key], limits }).status;
      return st === 'over' || st === 'under';
    }),
  );

  function Section({ title, items }: { title: string; items: [string, LotRow[]][] }) {
    if (items.length === 0) return null;
    return (
      <div className="mb-8">
        <h2 className="mb-3 font-serif text-lg">{title}</h2>
        <div className="overflow-x-auto rounded-lg border border-purity-bean/10 bg-white shadow-sm dark:border-purity-paper/10 dark:bg-purity-shade dark:shadow-none">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-purity-bean/10 text-left text-xs text-purity-muted dark:border-purity-paper/10 dark:text-purity-mist">
                <th className="p-3">Lot / report</th>
                <th className="p-3">Tested</th>
                {ALL.map((c) => <th key={c.key} className="p-3">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map(([groupKey, lots]) => (
                <Fragment key={groupKey}>
                  {/* Product header. The lot count is stated explicitly so a rep
                      can never mistake one lot's numbers for the product's. */}
                  <tr className="border-b border-purity-bean/10 bg-purity-cream/60 dark:border-purity-paper/10 dark:bg-purity-ink/50">
                    <td colSpan={2 + ALL.length} className="px-3 py-2">
                      <span className="font-semibold">{groupKey.replace(/^(Blend|Green) · /, '')}</span>
                      <span className="ml-2 text-xs text-purity-muted dark:text-purity-mist">
                        {lots.length === 1
                          ? '1 lot tested'
                          : `${lots.length} lots tested — each row below is one lot, values are not combined`}
                      </span>
                    </td>
                  </tr>
                  {lots.map((lr) => (
                    <tr key={lr.id} className="border-b border-purity-bean/5 hover:bg-purity-cream/40 dark:border-purity-paper/5 dark:hover:bg-purity-ink/40">
                      <td className="p-3">
                        <Link href={`/reports/${lr.id}`} className="block">
                          <span className="font-mono text-xs">{lr.lotNumber ?? lr.reportNumber ?? '—'}</span>
                          {lr.lotNumber && lr.reportNumber ? (
                            <span className="block font-mono text-[10px] text-purity-muted dark:text-purity-mist">
                              {lr.reportNumber}
                            </span>
                          ) : null}
                        </Link>
                      </td>
                      <td className="p-3 font-mono text-xs text-purity-muted dark:text-purity-mist">
                        {lr.reportDate ?? '—'}
                      </td>
                      {ALL.map((c) => {
                        const d = formatAnalyte(lr.values[c.key], lr.quals[c.key], c.unit);
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
                                ? `Not detected — below the lab's reporting limit of ${d.bound?.replace('<', '')} ${c.unit}. Lot ${lr.lotNumber ?? lr.reportNumber}, tested ${lr.reportDate ?? 'date unknown'}.`
                                : d.kind === 'not_tested'
                                  ? `This analyte was not measured on this lot (${lr.reportNumber ?? 'unknown report'})`
                                  : `Lot ${lr.lotNumber ?? lr.reportNumber}, tested ${lr.reportDate ?? 'date unknown'}`
                            }
                          >
                            <span className="block">{d.text}</span>
                            <span className="mt-0.5 block font-sans">
                              <LimitBadge
                                analyteKey={c.key}
                                value={lr.values[c.key]}
                                reported={lr.quals[c.key]}
                                limits={limits}
                                verified={limitsVerified}
                              />
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
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
        One row per tested lot. Values are never combined across lots — each number is
        from the single COA named on its row. Click a lot for its full COA.
      </p>
      {!limitsVerified ? (
        <div className="mb-4 rounded-lg border border-purity-rust/40 bg-purity-rust/10 p-3 text-sm">
          <p className="font-semibold text-purity-rust">Limit thresholds are unverified</p>
          <p className="mt-1 text-xs text-purity-bean dark:text-purity-paper">
            The <code className="font-mono">coa_limits</code> table could not be read, so the
            indicators below use built-in defaults from the application code rather than the
            thresholds on file. Treat every pass/fail marking as provisional.
          </p>
        </div>
      ) : null}
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
      {!error && lotRows.length === 0 && (
        <p className="text-purity-muted dark:text-purity-mist">No COA rows found.</p>
      )}

      {hasOutOfLimit ? (
        <div className="mb-6 max-w-2xl rounded-md border border-purity-rust/30 bg-purity-rust/5 p-3 text-xs">
          <p className="font-semibold text-purity-rust">
            Some results below are outside the threshold on file
          </p>
          <p className="mt-1 text-purity-bean dark:text-purity-paper">
            An <span className="font-semibold">OVER LIMIT</span> marking means the measured value
            for that analyte was above the strictest published threshold we track, shown on hover
            with its source. <span className="font-semibold">BELOW MINIMUM</span> means it fell
            under a minimum we track. Either is a statement about the measurement against that
            threshold, and nothing more.
          </p>
          <p className="mt-1 text-purity-bean dark:text-purity-paper">
            Do not interpret one for a customer or explain what it means for the product. Send the
            question to an editor with the product name, lot number and test date from this table.
          </p>
        </div>
      ) : null}

      <Section title="Blends" items={blends} />
      <Section title="Green coffees" items={greens} />
    </div>
  );
}
