'use client';

// Stacked bars per day: answered in chat (green/aqua) vs sent to a person (amber).
// Recharts is already in package.json (used by reports/AnalyteChart).

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export type ActivityRow = {
  day: string;
  answered_in_chat: number;
  sent_to_person: number;
  thumbs_up: number;
  thumbs_down: number;
};

const ANSWERED_COLOR = '#3F6B4A'; // purity-green
const ESCALATED_COLOR = '#F59E0B'; // amber-500

export function ActivityChart({ rows }: { rows: ActivityRow[] }) {
  if (!rows.length) {
    return (
      <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-purity-bean/20 text-sm text-purity-muted dark:border-purity-paper/20 dark:text-purity-mist">
        No activity in this window yet.
      </div>
    );
  }

  // Compress day label to "Apr 28" style.
  const data = rows.map((r) => ({
    ...r,
    label: formatDay(r.day),
  }));

  return (
    <div className="h-56 w-full rounded-lg border border-purity-bean/10 bg-white p-3 dark:border-purity-paper/10 dark:bg-purity-shade">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8A8279' }} interval="preserveEnd" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8A8279' }} />
          <Tooltip
            contentStyle={{
              border: '1px solid rgba(43,31,23,0.12)',
              borderRadius: 8,
              fontSize: 12,
              padding: 8,
            }}
            formatter={(value: number, key: string) => {
              const map: Record<string, string> = {
                answered_in_chat: 'Answered in chat',
                sent_to_person: 'Sent to a person',
              };
              return [value, map[key] ?? key];
            }}
            labelFormatter={(l) => l}
          />
          <Bar dataKey="answered_in_chat" stackId="a" fill={ANSWERED_COLOR} radius={[2, 2, 0, 0]} />
          <Bar dataKey="sent_to_person" stackId="a" fill={ESCALATED_COLOR} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatDay(d: string): string {
  // "2026-04-28" → "Apr 28"
  const [, mo, da] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(mo) - 1]} ${Number(da)}`;
}
