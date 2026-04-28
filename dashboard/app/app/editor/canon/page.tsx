// Canon review surface — three tabs (drafts / active / deprecated) plus a
// "Bulk add" entry point. Editors can edit any row (not just drafts) and
// flip status (active ↔ deprecated, restore from deprecated, etc.).

import { cookies } from 'next/headers';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';
import { CanonDraftList } from './_components/CanonDraftList';
import { CanonActiveList } from './_components/CanonActiveList';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

type Tab = 'drafts' | 'active' | 'deprecated';
const VALID_TABS: Tab[] = ['drafts', 'active', 'deprecated'];

export default async function CanonReviewPage({
  searchParams,
}: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const params = await searchParams;
  const tab: Tab = (VALID_TABS.includes(params.tab as Tab) ? params.tab : 'drafts') as Tab;
  const search = (params.q ?? '').trim();

  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return <p className="text-sm text-purity-muted dark:text-purity-mist">Sign in to review canon drafts.</p>;
  }
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) {
    return <p className="text-sm text-purity-rust">Editor role required.</p>;
  }

  // Fetch counts for all three tabs at once (drives the tab labels)
  const [draftCntRes, activeCntRes, deprecatedCntRes] = await Promise.all([
    supabase.from('canon_qa').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('canon_qa').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('canon_qa').select('id', { count: 'exact', head: true }).eq('status', 'deprecated'),
  ]);
  const draftCount = draftCntRes.count ?? 0;
  const activeCount = activeCntRes.count ?? 0;
  const deprecatedCount = deprecatedCntRes.count ?? 0;

  // Fetch the rows for the current tab
  let q = supabase
    .from('canon_qa')
    .select('id, question, answer, status, tags, created_at, created_by, origin_message_id, last_reviewed_at')
    .eq('status', tab === 'drafts' ? 'draft' : tab)
    .order('last_reviewed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (search) q = q.or(`question.ilike.%${search}%,answer.ilike.%${search}%`);
  const { data: rows } = await q;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">Canon</h1>
          <p className="mt-1 text-sm text-purity-muted dark:text-purity-mist">
            Review pending drafts, edit live entries, manage deprecated answers.
          </p>
        </div>
        <Link
          href="/editor/canon/bulk"
          className="rounded-md bg-purity-bean px-3 py-1.5 text-xs font-medium text-purity-cream transition hover:bg-purity-bean/85 dark:bg-purity-aqua dark:text-purity-ink dark:hover:bg-purity-aqua/85"
        >
          + Bulk add
        </Link>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-purity-bean/10 dark:border-purity-paper/10">
        <TabLink current={tab} value="drafts"     label="Drafts"     count={draftCount}     />
        <TabLink current={tab} value="active"     label="Active"     count={activeCount}    />
        <TabLink current={tab} value="deprecated" label="Deprecated" count={deprecatedCount} />
      </nav>

      <form className="flex items-center gap-2" action="">
        <input type="hidden" name="tab" value={tab} />
        <input
          name="q"
          defaultValue={search}
          placeholder="Search question or answer…"
          className="w-full max-w-sm rounded border border-purity-bean/20 bg-transparent px-2.5 py-1.5 text-sm dark:border-purity-paper/20 dark:text-purity-paper"
        />
        <button className="rounded-md border border-purity-bean/20 px-3 py-1.5 text-xs hover:bg-purity-cream dark:border-purity-paper/20 dark:text-purity-paper dark:hover:bg-purity-ink/40">
          Search
        </button>
        {search && (
          <Link href={`/editor/canon?tab=${tab}`} className="text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">
            clear
          </Link>
        )}
      </form>

      {tab === 'drafts' ? (
        <CanonDraftList drafts={rows ?? []} />
      ) : (
        <CanonActiveList rows={rows ?? []} tab={tab} />
      )}
    </div>
  );
}

function TabLink({ current, value, label, count }: { current: Tab; value: Tab; label: string; count: number }) {
  const active = current === value;
  return (
    <Link
      href={`/editor/canon?tab=${value}`}
      className={
        'relative -mb-px px-4 py-2 text-sm transition ' +
        (active
          ? 'border-b-2 border-purity-green font-medium text-purity-bean dark:border-purity-aqua dark:text-purity-paper'
          : 'border-b-2 border-transparent text-purity-muted hover:text-purity-bean dark:text-purity-mist dark:hover:text-purity-paper')
      }
    >
      {label}
      <span className={
        'ml-2 inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-0.5 text-[10px] ' +
        (active
          ? 'bg-purity-green/15 text-purity-green dark:bg-purity-aqua/15 dark:text-purity-aqua'
          : 'bg-purity-bean/10 text-purity-muted dark:bg-purity-paper/10 dark:text-purity-mist')
      }>
        {count}
      </span>
    </Link>
  );
}
