// /heatmap — Customer-Question Heatmap. Editor-only.
// Reads the question_heatmap view; renders a grid of cells with demand
// (color intensity) + supply (filled vs. hollow corner indicator).

import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { TopicCell, type HeatmapRow } from './_components/TopicCell';

export const dynamic = 'force-dynamic';

type Search = {
  category?: string;
  sort?: string;     // 'priority' | 'msg' | 'miss' | 'gap'
  gaps_only?: string;
};

const CATEGORIES = [
  { key: 'compound',       label: 'Compounds' },
  { key: 'contaminant',    label: 'Contaminants' },
  { key: 'blend',          label: 'Blends' },
  { key: 'process',        label: 'Process' },
  { key: 'health_outcome', label: 'Health outcomes' },
  { key: 'operations',     label: 'Operations' },
] as const;

export default async function HeatmapPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return <p className="text-sm text-purity-muted">Sign in to view the heatmap.</p>;
  const { data: profile } = await sb.from('profiles').select('role').eq('id', auth.user.id).single();
  if (profile?.role !== 'editor') {
    return <p className="text-sm text-purity-rust">Editor role required.</p>;
  }

  let q = sb
    .from('question_heatmap')
    .select('*')
    .order('priority_score', { ascending: false })
    .limit(500);
  if (params.category) q = q.eq('category', params.category);
  if (params.gaps_only === '1') q = q.eq('canon_gap', true);

  const { data: rowsData } = await q;
  const rows: HeatmapRow[] = rowsData ?? [];

  const sort = params.sort ?? 'priority';
  const sorted = [...rows].sort((a, b) => {
    if (sort === 'msg')   return (b.msg_count_30d ?? 0) - (a.msg_count_30d ?? 0);
    if (sort === 'miss')  return (Number(b.miss_rate ?? 0)) - Number(a.miss_rate ?? 0);
    if (sort === 'gap')   return Number(b.canon_gap) - Number(a.canon_gap) || (b.msg_count_30d - a.msg_count_30d);
    return Number(b.priority_score ?? 0) - Number(a.priority_score ?? 0);
  });

  const totalTopics = rows.length;
  const gapCount = rows.filter((r) => r.canon_gap).length;
  const totalMsgs30d = rows.reduce((s, r) => s + (r.msg_count_30d ?? 0), 0);
  const topGaps = rows.filter((r) => r.canon_gap).slice(0, 3);

  // Group by category for the grid
  const byCategory: Record<string, HeatmapRow[]> = {};
  for (const r of sorted) {
    (byCategory[r.category] ??= []).push(r);
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">Question heatmap</h1>
          <p className="text-sm text-purity-muted dark:text-purity-mist">
            Where customers ask · where canon is thin. Filled corner = canon exists. Hollow ring = gap.
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <select name="category" defaultValue={params.category ?? ''} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper">
            <option value="">all categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <select name="sort" defaultValue={sort} className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper">
            <option value="priority">sort: priority</option>
            <option value="msg">sort: most asked (30d)</option>
            <option value="miss">sort: highest miss-rate</option>
            <option value="gap">sort: gaps first</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-purity-muted dark:text-purity-mist">
            <input type="checkbox" name="gaps_only" value="1" defaultChecked={params.gaps_only === '1'} />
            gaps only
          </label>
          <button className="rounded-md bg-purity-bean px-3 py-1 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink">Apply</button>
        </form>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Topics" value={String(totalTopics)} />
        <Tile label="Canon gaps" value={String(gapCount)} sub={totalTopics ? `${Math.round((gapCount / totalTopics) * 100)}% of topics` : undefined} />
        <Tile label="Msgs (30d)" value={totalMsgs30d.toLocaleString()} />
        <Tile
          label="Priority topics"
          value={topGaps.length ? topGaps.map((g) => g.label).join(', ') : 'no urgent gaps'}
          big={false}
        />
      </section>

      <div className="space-y-8">
        {CATEGORIES.map((cat) => {
          const list = byCategory[cat.key];
          if (!list?.length) return null;
          return (
            <section key={cat.key}>
              <h2 className="mb-3 font-serif text-lg">{cat.label}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list.map((r) => (
                  <TopicCell key={r.id} row={r} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, big = true }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
      <div className="text-xs uppercase tracking-wide text-purity-muted dark:text-purity-mist">{label}</div>
      <div className={'mt-1 ' + (big ? 'font-serif text-2xl' : 'text-sm')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-purity-muted dark:text-purity-mist">{sub}</div>}
    </div>
  );
}
