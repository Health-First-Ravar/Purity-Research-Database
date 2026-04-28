import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { CopyButton } from '../../_components/CopyButton';
import { CoaEditableFields } from './EditableFields';
import { hasElevatedAccess } from '@/lib/auth-roles';
import { evaluate, fmtValue, statusStyle, getLimit, loadLimits, type EvalResult, type Limit } from '@/lib/coa-limits';

export const dynamic = 'force-dynamic';

type Analyte = { value: number | null; unit: string | null; panel: string | null; as_reported?: string | null };

export default async function CoaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = supabaseServer(await cookies());

  const { data: row, error } = await supabase
    .from('coas')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !row) notFound();

  const { data: auth } = await supabase.auth.getUser();
  let isEditor = false;
  if (auth.user) {
    const { data: p } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    isEditor = hasElevatedAccess(p?.role);
  }

  const limits = await loadLimits();
  const raw = (row.raw_values ?? {}) as Record<string, Analyte>;
  const analyteRows = Object.entries(raw)
    .map(([name, v]) => ({ name, ...(v ?? {}) }))
    .sort((a, b) => (a.panel ?? '').localeCompare(b.panel ?? '') || a.name.localeCompare(b.name));

  const metals = (row.heavy_metals ?? null) as Record<string, number | null> | null;
  const qualifiers = (row.value_qualifiers ?? {}) as Record<string, string>;

  // Evaluate every limit-bearing analyte and tally exceedances for the header badge.
  const evaluations: { key: string; eval: EvalResult }[] = [
    { key: 'ota_ppb',         eval: evaluate({ key: 'ota_ppb',         value: row.ota_ppb        as number | null, reported: qualifiers['ota_ppb']        ?? null, limits }) },
    { key: 'aflatoxin_ppb',   eval: evaluate({ key: 'aflatoxin_ppb',   value: row.aflatoxin_ppb  as number | null, reported: qualifiers['aflatoxin_ppb']  ?? null, limits }) },
    { key: 'acrylamide_ppb',  eval: evaluate({ key: 'acrylamide_ppb',  value: row.acrylamide_ppb as number | null, reported: qualifiers['acrylamide_ppb'] ?? null, limits }) },
    { key: 'cga_mg_g',        eval: evaluate({ key: 'cga_mg_g',        value: row.cga_mg_g       as number | null, reported: qualifiers['cga_mg_g']       ?? null, limits }) },
    { key: 'caffeine_pct',    eval: evaluate({ key: 'caffeine_pct',    value: row.caffeine_pct   as number | null, reported: qualifiers['caffeine_pct']   ?? null, limits }) },
    { key: 'moisture_pct',    eval: evaluate({ key: 'moisture_pct',    value: row.moisture_pct   as number | null, reported: qualifiers['moisture_pct']   ?? null, limits }) },
    { key: 'water_activity',  eval: evaluate({ key: 'water_activity',  value: row.water_activity as number | null, reported: qualifiers['water_activity'] ?? null, limits }) },
  ];
  if (metals) {
    for (const [name, v] of Object.entries(metals)) {
      const k = `heavy_metals.${name}`;
      evaluations.push({ key: k, eval: evaluate({ key: k, value: v ?? null, reported: qualifiers[k] ?? null, limits }) });
    }
  }
  const exceedances = evaluations.filter((e) => e.eval.status === 'over' || e.eval.status === 'under');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/reports" className="text-sm text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">
          ← Back to Reports
        </Link>
      </div>

      <h1 className="mb-1 font-serif text-2xl">
        {row.coffee_name ?? row.blend ?? 'COA Report'}
      </h1>
      <p className="mb-3 text-sm text-purity-muted dark:text-purity-mist">
        Report {row.report_number ?? '—'} · {row.report_date ?? 'no date'} · {row.lab ?? 'unknown lab'}
      </p>

      <ComplianceBadge exceedances={exceedances.length} />

      <section className="mb-6 grid gap-4 rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade md:grid-cols-2">
        <Field label="Report number" value={row.report_number} mono />
        <Field label="Report date" value={row.report_date} />
        <Field label="Blend" value={row.blend} />
        <Field label="Coffee name" value={row.coffee_name} />
        <Field label="Lot number" value={row.lot_number} mono />
        <Field label="Lab" value={row.lab} />
        {row.pdf_filename && (
          <div className="md:col-span-2">
            <div className="text-xs text-purity-muted dark:text-purity-mist">Source PDF</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="break-all rounded bg-purity-cream/60 px-2 py-1 text-xs dark:bg-purity-ink/40">{row.pdf_filename as string}</code>
              <CopyButton text={row.pdf_filename as string} label="Copy filename" />
            </div>
            <div className="mt-1 text-[11px] text-purity-muted dark:text-purity-mist">Search Drive for this filename to open the original.</div>
          </div>
        )}
      </section>

      {isEditor && (
        <section className="mb-6 rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
          <h2 className="mb-3 text-sm font-medium">Edit filing (editor)</h2>
          <CoaEditableFields
            id={row.id as string}
            origin={(row.origin as string | null) ?? ''}
            region={(row.region as string | null) ?? ''}
          />
        </section>
      )}

      {!isEditor && (
        <section className="mb-6 grid gap-4 rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade md:grid-cols-2">
          <Field label="Origin" value={row.origin as string | null} />
          <Field label="Region" value={row.region as string | null} />
        </section>
      )}

      <section className="mb-6 rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
        <h2 className="border-b border-purity-bean/10 px-4 py-3 text-sm font-medium dark:border-purity-paper/10">
          Headline analytes
        </h2>
        <div className="grid gap-3 p-4 text-sm md:grid-cols-3">
          <LimitField dataKey="ota_ppb"         label="OTA (ppb)"          value={row.ota_ppb        as number | null} reported={qualifiers['ota_ppb']        ?? null} limits={limits} />
          <LimitField dataKey="aflatoxin_ppb"   label="Aflatoxin (ppb)"    value={row.aflatoxin_ppb  as number | null} reported={qualifiers['aflatoxin_ppb']  ?? null} limits={limits} />
          <LimitField dataKey="acrylamide_ppb"  label="Acrylamide (ppb)"   value={row.acrylamide_ppb as number | null} reported={qualifiers['acrylamide_ppb'] ?? null} limits={limits} />
          <LimitField dataKey="cga_mg_g"        label="CGAs (mg/g)"        value={row.cga_mg_g       as number | null} reported={qualifiers['cga_mg_g']       ?? null} limits={limits} />
          <LimitField dataKey="melanoidins_mg_g"label="Melanoidins (mg/g)" value={row.melanoidins_mg_g as number | null} reported={qualifiers['melanoidins_mg_g'] ?? null} limits={limits} />
          <LimitField dataKey="trigonelline_mg_g" label="Trigonelline (mg/g)" value={row.trigonelline_mg_g as number | null} reported={qualifiers['trigonelline_mg_g'] ?? null} limits={limits} />
          <LimitField dataKey="caffeine_pct"    label="Caffeine (%)"       value={row.caffeine_pct   as number | null} reported={qualifiers['caffeine_pct']   ?? null} limits={limits} />
          <LimitField dataKey="moisture_pct"    label="Moisture (%)"       value={row.moisture_pct   as number | null} reported={qualifiers['moisture_pct']   ?? null} limits={limits} />
          <LimitField dataKey="water_activity"  label="Water activity"     value={row.water_activity as number | null} reported={qualifiers['water_activity'] ?? null} limits={limits} />
        </div>
      </section>

      {metals && Object.keys(metals).length > 0 && (
        <section className="mb-6 rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
          <h2 className="border-b border-purity-bean/10 px-4 py-3 text-sm font-medium dark:border-purity-paper/10">
            Heavy metals (ppb)
          </h2>
          <div className="grid gap-3 p-4 text-sm md:grid-cols-3">
            {Object.entries(metals).map(([k, v]) => (
              <LimitField
                key={k}
                dataKey={`heavy_metals.${k}`}
                label={k}
                value={v}
                reported={qualifiers[`heavy_metals.${k}`] ?? null}
                limits={limits}
              />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
        <h2 className="border-b border-purity-bean/10 px-4 py-3 text-sm font-medium dark:border-purity-paper/10">
          All analytes ({analyteRows.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-purity-bean/10 text-left text-xs text-purity-muted dark:border-purity-paper/10 dark:text-purity-mist">
                <th className="p-3">Analyte</th>
                <th className="p-3">Panel</th>
                <th className="p-3">Value</th>
                <th className="p-3">Unit</th>
              </tr>
            </thead>
            <tbody>
              {analyteRows.map((a) => {
                const display = a.as_reported && /^[<>]/.test(a.as_reported.trim())
                  ? a.as_reported.trim()
                  : (a.value ?? '—');
                const rawEval = evaluate({ key: `raw:${a.name}`, value: a.value ?? null, reported: a.as_reported ?? null, limits });
                const cls = statusStyle(rawEval.status);
                return (
                  <tr key={a.name} className="border-b border-purity-bean/5 dark:border-purity-paper/5">
                    <td className="p-3">{a.name}</td>
                    <td className="p-3 text-purity-muted dark:text-purity-mist">{a.panel ?? '—'}</td>
                    <td className={`p-3 font-mono ${cls}`}>{display}</td>
                    <td className="p-3 text-purity-muted dark:text-purity-mist">{a.unit ?? '—'}</td>
                  </tr>
                );
              })}
              {analyteRows.length === 0 && (
                <tr><td colSpan={4} className="p-4 text-purity-muted dark:text-purity-mist">No raw analytes captured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ComplianceBadge({ exceedances }: { exceedances: number }) {
  if (exceedances === 0) {
    return (
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-purity-green/30 bg-purity-green/10 px-3 py-1 text-xs text-purity-green dark:border-purity-aqua/30 dark:bg-purity-aqua/10 dark:text-purity-aqua">
        <span className="inline-block h-2 w-2 rounded-full bg-purity-green dark:bg-purity-aqua" />
        Within limits
      </div>
    );
  }
  return (
    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-purity-rust/30 bg-purity-rust/10 px-3 py-1 text-xs font-medium text-purity-rust">
      <span className="inline-block h-2 w-2 rounded-full bg-purity-rust" />
      {exceedances} value{exceedances > 1 ? 's' : ''} outside limit
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: unknown; mono?: boolean }) {
  const display = value == null || value === '' ? '—' : String(value);
  return (
    <div>
      <div className="text-xs text-purity-muted dark:text-purity-mist">{label}</div>
      <div className={mono ? 'font-mono text-sm' : 'text-sm'}>{display}</div>
    </div>
  );
}

/** Field that evaluates a numeric value against the strictest published limit
 *  and renders it in the matching status color. Tooltip shows the limit + source. */
function LimitField({
  dataKey, label, value, reported, limits,
}: {
  dataKey: string; label: string; value: number | null | undefined; reported: string | null; limits: Limit[];
}) {
  const result = evaluate({ key: dataKey, value, reported, limits });
  const limit  = getLimit(dataKey, limits);
  const display = fmtValue(value ?? null, reported);

  let limitText = '';
  if (limit) {
    if (limit.direction === 'ceiling') limitText = `< ${limit.value} ${limit.unit}`;
    else if (limit.direction === 'floor') limitText = `≥ ${limit.value} ${limit.unit}`;
    else if (limit.direction === 'range') limitText = `${limit.min}–${limit.max} ${limit.unit}`;
  }

  let title = '';
  if (limit) title = `${limit.label} — limit ${limitText}\nSource: ${limit.source}${limit.notes ? '\n' + limit.notes : ''}`;

  return (
    <div title={title}>
      <div className="text-xs text-purity-muted dark:text-purity-mist">
        {label}
        {limit && (
          <span className="ml-1 text-[10px] text-purity-muted/70 dark:text-purity-mist/70">
            (limit {limitText})
          </span>
        )}
      </div>
      <div className={`mt-0.5 font-mono text-sm ${statusStyle(result.status)}`}>
        {display}
        {result.status === 'over'  && <span className="ml-2 text-[10px] uppercase tracking-wider">over</span>}
        {result.status === 'under' && <span className="ml-2 text-[10px] uppercase tracking-wider">under</span>}
      </div>
    </div>
  );
}
