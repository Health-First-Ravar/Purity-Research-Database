// Research Hub home: one question box, what needs attention, and every product
// at a glance. COA data is Brian's Lab Testing tracker, synced read-only.

import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { canChat } from '@/lib/auth-roles';
import { analyteStatus, LABEL, MATRIX, panelState, RANK, type Status } from '@/lib/lab-status';
import { attentionItems, getHubRole, homeKpis, isStaffRole, loadLab, niceDate, productsWithData, productSlug, todayISO } from '@/lib/lab-data';
import { AttentionList, Card, Kpi, KpiRow, TrackerNote } from './_components/hub';
import { StatusChip } from './_components/StatusChip';

export const dynamic = 'force-dynamic';

const EXAMPLES = [
  'Is EASE tested for ochratoxin A?',
  'What are the lead results for our core blends?',
  'Is your coffee mold free?',
  'Do chlorogenic acids survive roasting?',
];

export default async function HomePage() {
  const sb = supabaseServer(await cookies());
  const { userId, role } = await getHubRole(sb);
  if (!userId) redirect('/login?next=/');
  const staff = isStaffRole(role);
  const today = todayISO();
  const { recs, std, syncedAt } = await loadLab(sb);
  const items = attentionItems(recs, std, today, staff);
  const k = homeKpis(recs, std, today, staff);
  const products = productsWithData(recs);
  const chatOk = canChat(role);

  return (
    <div className="grid gap-4">
      <Card title="Ask anything" hint="Research, support, COA and claim questions all start here.">
        {chatOk ? (
          <>
            <form action="/chat" method="get" className="flex flex-col gap-2.5 sm:flex-row">
              <input
                name="q"
                required
                autoComplete="off"
                placeholder="Ask about research, a product's COA, a claim or a customer question"
                className="min-w-0 flex-1 rounded-hub border border-purity-line bg-purity-card px-4 py-3 text-base dark:border-purity-rule dark:bg-purity-shade"
              />
              <button type="submit" className="rounded-hub bg-purity-teal px-5 py-3 font-bold text-white dark:bg-purity-glow dark:text-purity-ink">Ask</button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((q) => (
                <Link key={q} href={`/chat?q=${encodeURIComponent(q)}`} className="rounded-full border border-purity-line px-3 py-1 text-sm hover:border-purity-aqua hover:text-purity-teal dark:border-purity-rule">{q}</Link>
              ))}
              <Link href="/audit" className="rounded-full border border-purity-line px-3 py-1 text-sm hover:border-purity-aqua hover:text-purity-teal dark:border-purity-rule">Check a claim</Link>
            </div>
          </>
        ) : (
          <p className="text-sm">
            Claim checks run in <Link className="font-semibold text-purity-teal underline dark:text-purity-glow" href="/audit">Check a claim</Link>; escalated questions are in the <Link className="font-semibold text-purity-teal underline dark:text-purity-glow" href="/editor">review queue</Link>.
          </p>
        )}
      </Card>

      <KpiRow>
        <Kpi label="Core blends current" value={`${k.current} of 5`} sub="Full contaminant panel in the last 12 months" alert={k.current < 5} />
        <Kpi label="Contaminants over limit" value={k.overLimit} sub={staff ? 'Last 12 months, all samples' : 'Last 12 months, finished products'} alert={k.overLimit > 0} />
        <Kpi label="Awaiting the lab" value={k.awaiting} sub="Samples ordered, no result yet" />
        <Kpi label="Latest result" value={k.latest ? niceDate(k.latest.test_date, false) : 'None'} sub={k.latest ? `${k.latest.product || k.latest.name} · ${k.latest.lab}` : ''} />
      </KpiRow>

      <Card title="Needs attention" hint={`${staff ? 'All samples' : 'Finished products'}, last 24 months.`}>
        <AttentionList items={items} limit={6} />
        {items.length > 6 && <p className="mt-2 text-sm"><Link className="text-purity-teal underline dark:text-purity-glow" href="/coa">{items.length - 6} more in COA quick view</Link></p>}
      </Card>

      <Card title="Products" hint="Latest result per product. Open a product for its full history.">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
          {products.map((p) => {
            const ps = panelState(p, recs, today);
            let worst: Status = 'info';
            for (const c of MATRIX) {
              const r = recs.find((x) => x.kind === 'product' && x.product === p && x.status !== 'Awaiting sample' && x.analytes?.[c]);
              const a = r && analyteStatus(r, c, std);
              if (a && RANK[a.status] > RANK[worst]) worst = a.status;
            }
            return (
              <Link key={p} href={`/coa/${productSlug(p)}`} className="grid gap-1.5 rounded-hub border border-purity-line bg-purity-card p-4 hover:border-purity-aqua dark:border-purity-rule dark:bg-purity-shade">
                <span className="font-bold text-purity-teal dark:text-purity-glow">{p}</span>
                <span className="text-sm text-purity-muted dark:text-purity-mist">{ps.full ? `Full panel ${niceDate(ps.full.test_date)}` : 'No full panel on file'}</span>
                <span><StatusChip status={ps.status} label={ps.label} /></span>
                {p !== 'SACRED CUPS' && worst !== 'info' && <span className="text-xs text-purity-muted dark:text-purity-mist">Worst latest result: {LABEL[worst]}</span>}
              </Link>
            );
          })}
        </div>
      </Card>
      <TrackerNote syncedAt={syncedAt} />
    </div>
  );
}
