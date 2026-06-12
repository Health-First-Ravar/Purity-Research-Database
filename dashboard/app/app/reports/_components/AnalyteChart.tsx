'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Row = {
  id: string;
  report_date: string | null;
  blend: string | null;
  coffee_name: string | null;
  lot_number: string | null;
  origin: string | null;
  lab: string | null;
  [key: string]: unknown;
};

type LimitMark = {
  direction: 'ceiling' | 'floor' | 'range';
  value?: number | null;
  min?: number | null;
  max?: number | null;
  label?: string;
};

type AnalyteSel = { key: string; label: string };

type Props = {
  rows: Row[];
  analytes: AnalyteSel[];
  limit?: LimitMark | null;
};

const BLEND_COLORS: Record<string, string> = {
  PROTECT: '#3F6B4A',
  FLOW: '#009F8D',
  EASE: '#B04A2E',
  CALM: '#2E3A3A',
};
const SERIES_COLORS = [
  '#3F6B4A', '#B04A2E', '#009F8D', '#2E3A3A',
  '#A07A2C', '#6B5AA0', '#3A6EA5', '#9A6B3F',
  '#7c6b5a', '#5a7c6b', '#6b7c5a', '#7c5a6b',
];

export function AnalyteChart({ rows, analytes, limit }: Props) {
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const multi = analytes.length > 1;
  const [normalize, setNormalize] = useState(multi);

  useEffect(() => {
    const update = () => setDark(document.documentElement.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  function readVal(r: Row, key: string): number | null {
    if (key.startsWith('raw:')) {
      const name = key.slice(4);
      const raw = (r.raw_values ?? {}) as Record<string, { value?: number | null } | undefined>;
      const v = raw[name]?.value;
      return typeof v === 'number' ? v : null;
    }
    const v = r[key];
    return typeof v === 'number' ? v : null;
  }

  const single = analytes[0];
  const blends = useMemo(
    () => Array.from(new Set(rows.map((r) => r.blend ?? 'unknown'))).sort(),
    [rows],
  );

  const analyteMax = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of analytes) {
      let mx = 0;
      for (const r of rows) {
        const v = readVal(r, a.key);
        if (v != null && Math.abs(v) > mx) mx = Math.abs(v);
      }
      m[a.key] = mx || 1;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, analytes]);

  const chartData = useMemo(() => {
    const byDate: Record<string, Record<string, unknown>> = {};
    for (const r of rows) {
      if (!r.report_date) continue;
      const d = r.report_date;
      if (!byDate[d]) byDate[d] = { date: d };
      if (!multi) {
        const val = readVal(r, single.key);
        if (val == null) continue;
        const blend = r.blend ?? 'unknown';
        byDate[d][blend] = Number(val);
        byDate[d][`${blend}__id`] = r.id;
      } else {
        for (const a of analytes) {
          const val = readVal(r, a.key);
          if (val == null) continue;
          const sumKey = `${a.key}__sum`;
          const cntKey = `${a.key}__cnt`;
          byDate[d][sumKey] = ((byDate[d][sumKey] as number) ?? 0) + val;
          byDate[d][cntKey] = ((byDate[d][cntKey] as number) ?? 0) + 1;
        }
      }
    }
    const out = Object.values(byDate).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
    if (multi) {
      for (const row of out) {
        for (const a of analytes) {
          const sum = row[`${a.key}__sum`] as number | undefined;
          const cnt = row[`${a.key}__cnt`] as number | undefined;
          if (sum != null && cnt) {
            const meanv = sum / cnt;
            row[`${a.key}__raw`] = meanv;
            row[a.key] = normalize ? (Math.abs(meanv) / analyteMax[a.key]) * 100 : meanv;
          }
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, analytes, multi, normalize, analyteMax]);

  const vals = !multi
    ? rows.map((r) => readVal(r, single.key)).filter((v): v is number => v != null)
    : [];
  const count = vals.length;
  const min = count ? Math.min(...vals) : null;
  const max = count ? Math.max(...vals) : null;
  const mean = count ? vals.reduce((a, b) => a + b, 0) / count : null;
  const stddev = count > 1
    ? Math.sqrt(vals.reduce((a, b) => a + (b - mean!) ** 2, 0) / (count - 1))
    : null;

  const axisColor = dark ? '#9A9189' : '#8A8279';
  const gridColor = dark ? 'rgba(236,227,212,0.08)' : 'rgba(43,31,23,0.07)';
  const bgColor = dark ? '#221A14' : '#ffffff';

  function blendColor(blend: string, i: number): string {
    return BLEND_COLORS[blend] ?? SERIES_COLORS[i % SERIES_COLORS.length];
  }

  function handleDotClick(blend: string, payload: unknown) {
    const p = payload as Record<string, unknown> | undefined;
    const id = p?.[`${blend}__id`];
    if (typeof id === 'string') router.push(`/reports/${id}`);
  }

  return (
    <div className="space-y-4">
      {!multi && count > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          <Stat label="Reports tested" value={String(count)} accent />
          <Stat label="Lowest" value={fmt(min!)} />
          <Stat label="Highest" value={fmt(max!)} />
          <Stat label="Average" value={fmt(mean!)} />
          {stddev != null && <Stat label="Variability (σ)" value={fmt(stddev)} />}
        </div>
      )}

      {multi && (
        <label className="flex items-center gap-2 text-xs text-purity-muted dark:text-purity-mist">
          <input
            type="checkbox"
            checked={normalize}
            onChange={(e) => setNormalize(e.target.checked)}
            className="h-4 w-4 rounded border-purity-bean/30 dark:border-purity-paper/30"
          />
          Normalise each analyte to % of its own max (keeps mixed units readable)
        </label>
      )}

      <div className="rounded-lg border border-purity-bean/10 dark:border-purity-paper/10" style={{ background: bgColor }}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: axisColor }}
              tickLine={false}
              axisLine={false}
              label={{
                value: multi ? (normalize ? '% of max' : 'value') : single.label,
                angle: -90, position: 'insideLeft', offset: 10,
                style: { fontSize: 11, fill: axisColor },
              }}
            />
            <Tooltip
              contentStyle={{ background: bgColor, borderColor: gridColor, fontSize: 12 }}
              labelStyle={{ color: axisColor }}
              formatter={(value: number, name: string, item: { payload?: Record<string, unknown> }) => {
                if (multi && normalize) {
                  const a = analytes.find((x) => x.label === name);
                  const raw = a && item?.payload ? (item.payload[`${a.key}__raw`] as number | undefined) : undefined;
                  return raw != null ? [`${fmt(raw)} (${fmt(value)}%)`, name] : [fmt(value), name];
                }
                return [fmt(value), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />

            {!multi
              ? blends.map((blend, i) => (
                  <Line
                    key={blend}
                    type="monotone"
                    dataKey={blend}
                    stroke={blendColor(blend, i)}
                    strokeWidth={2}
                    dot={{ r: 3, style: { cursor: 'pointer' } }}
                    activeDot={{
                      r: 6,
                      style: { cursor: 'pointer' },
                      onClick: (_e: unknown, payload: unknown) => {
                        const p = (payload as { payload?: unknown })?.payload;
                        handleDotClick(blend, p);
                      },
                    }}
                    connectNulls={false}
                  />
                ))
              : analytes.map((a, i) => (
                  <Line
                    key={a.key}
                    type="monotone"
                    dataKey={a.key}
                    name={a.label}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls={false}
                  />
                ))}

            {!multi && limit?.direction === 'ceiling' && limit.value != null && (
              <ReferenceLine y={limit.value} stroke="#B04A2E" strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: `limit ${limit.value}`, position: 'insideTopRight', fontSize: 10, fill: '#B04A2E' }} />
            )}
            {!multi && limit?.direction === 'floor' && limit.value != null && (
              <ReferenceLine y={limit.value} stroke="#B04A2E" strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: `min ${limit.value}`, position: 'insideBottomRight', fontSize: 10, fill: '#B04A2E' }} />
            )}
            {!multi && limit?.direction === 'range' && limit.max != null && (
              <ReferenceLine y={limit.max} stroke="#B04A2E" strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: `max ${limit.max}`, position: 'insideTopRight', fontSize: 10, fill: '#B04A2E' }} />
            )}
            {!multi && limit?.direction === 'range' && limit.min != null && (
              <ReferenceLine y={limit.min} stroke="#B04A2E" strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: `min ${limit.min}`, position: 'insideBottomRight', fontSize: 10, fill: '#B04A2E' }} />
            )}
          </LineChart>
        </ResponsiveContainer>
        <p className="px-4 pb-3 text-[11px] text-purity-muted dark:text-purity-mist">
          {multi
            ? 'Each line is one analyte (mean across matching COAs per date).'
            : 'Click a point to view the full COA report.'}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={
        'rounded-lg border px-3 py-2 ' +
        (accent
          ? 'border-purity-green/20 bg-purity-green/5 dark:border-purity-aqua/20 dark:bg-purity-aqua/10'
          : 'border-purity-bean/10 bg-purity-cream/40 dark:border-purity-paper/10 dark:bg-purity-ink/30')
      }
    >
      <div className="text-[10px] uppercase tracking-wider text-purity-muted dark:text-purity-mist">
        {label}
      </div>
      <div className="mt-0.5 font-serif text-lg leading-tight tabular-nums text-purity-bean dark:text-purity-paper">
        {value}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(2);
  if (abs >= 0.1) return n.toFixed(3);
  return n.toPrecision(2);
}
