// Canon review surface — four tabs plus a "Bulk add" entry point.
//
// Gaps is the entry point and the default. It reads canon_misses (questions the
// assistant answered badly) rather than promotion_candidates, which filters on a
// customer thumbs-up that has never once been given and is therefore
// structurally empty. Drafts / active / deprecated manage canon_qa itself.
//
// Editors can edit any row (not just drafts) and flip status
// (active <-> deprecated, restore from deprecated, etc.).

import { cookies } from 'next/headers';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';
import { CanonDraftList } from './_components/CanonDraftList';
import { CanonActiveList } from './_components/CanonActiveList';
import { CanonGapList, type GapRow } from './_components/CanonGapList';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

type Tab = 'gaps' | 'drafts' | 'active' | 'deprecated';
const VALID_TABS: Tab[] = ['gaps', 'drafts', 'active', 'deprecated'];

export default async function CanonReviewPage({
  searchParams,
}: { searchParams: Promise<{ tab?: string; q?: string; topic?: string }> }) {
  const params = await searchParams;
  const tab: Tab = (VALID_TABS.includes(params.tab as Tab) ? params.tab : 'gaps') as Tab;

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

  // Canon gaps. `promotion_candidates` filters on a customer thumbs-up that has
  // never once been given, so it is structurally empty; `canon_misses` fills
  // itself from escalations and low-confidence turns. Exclude misses that have
  // already been turned into canon so the queue drains as it is worked.
  const { data: promotedRows } = await supabase
    .from('canon_qa')
    .select('origin_message_id')
    .not('origin_message_id', 'is', null);
  const alreadyPromoted = new Set((promotedRows ?? []).map((r) => r.origin_message_id as string));

  const { data: missRows } = await supabase
    .from('canon_misses')
    .select('message_id, question, answer, classification, confidence_score, escalated, escalation_reason, insufficient_evidence, user_rating, user_rating_note, created_at')
    .limit(200);
  const gapRows = ((missRows ?? []) as GapRow[]).filter((r) => !alreadyPromoted.has(r.message_id));
  const gapCount = gapRows.length;

  // The heatmap's "Draft canon for this topic →" sends ?topic=<slug>. This page
  // previously read only tab and q, so that link landed on an unfiltered list
  // and the editor had to re-find the topic by hand — severing the one workflow
  // the heatmap exists to start. Resolve the slug to its human label and use it
  // as the search term.
  let topicLabel: string | null = null;
  if (params.topic) {
    const { data: topic } = await supabase
      .from('question_topics')
      .select('label')
      .eq('slug', params.topic)
      .maybeSingle();
    topicLabel = topic?.label ?? null;
  }
  const search = (params.q ?? topicLabel ?? '').trim();

  // Fetch the canon rows for the current tab. Skipped entirely on the gaps tab,
  // which reads canon_misses above — 'gaps' is not a canon_qa status.
  // Row shape differs per tab (Draft vs CanonRow); the child components own the
  // precise types, so this stays loose deliberately.
  let rows: Record<string, unknown>[] | null = null;
  let rowsError: { message: string } | null = null;
  if (tab !== 'gaps') {
    let q = supabase
      .from('canon_qa')
      .select('id, question, answer, status, tags, created_at, created_by, origin_message_id, last_reviewed_at')
      .eq('status', tab === 'drafts' ? 'draft' : tab)
      .order('last_reviewed_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(200);
    // Strip the characters that break PostgREST's .or() grammar — same treatment
    // as the COA search in app/reports/page.tsx. A term containing a comma
    // produced a malformed filter, and because the error was discarded below,
    // the page rendered it as "no matches", telling an editor canon is empty
    // when it is not. (Verified via an authenticated JWT: commas error with
    // PGRST100; parentheses turned out to be harmless. Stripping both anyway.)
    const searchTerm = search.replace(/[,()]/g, ' ').trim();
    if (searchTerm) q = q.or(`question.ilike.%${searchTerm}%,answer.ilike.%${searchTerm}%`);
    const res = await q;
    rows = res.data;
    rowsError = res.error;
  }

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
        <TabLink current={tab} value="gaps"       label="Gaps"       count={gapCount}       />
        <TabLink current={tab} value="drafts"     label="Drafts"     count={draftCount}     />
        <TabLink current={tab} value="active"     label="Active"     count={activeCount}    />
        <TabLink current={tab} value="deprecated" label="Deprecated" count={deprecatedCount} />
      </nav>

      {tab !== 'gaps' && topicLabel && !params.q && (
        <p className="rounded-md border border-purity-bean/15 bg-purity-cream/60 px-3 py-2 text-xs text-purity-muted dark:border-purity-paper/15 dark:bg-purity-ink/30 dark:text-purity-mist">
          Filtered to <span className="font-medium">{topicLabel}</span>, from the
          question heatmap. Clear the search to see all {tab}.
        </p>
      )}

      {tab !== 'gaps' && (
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
      )}

      {/* Never let a failed query render as an empty result — that is how a
          search bug reads as "canon is empty" for months. */}
      {rowsError ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">
            This search could not be run.
          </p>
          <p className="mt-1 text-purity-muted dark:text-purity-mist">
            No results are shown because the query failed, not because canon is
            empty. Try a simpler search term. ({rowsError.message})
          </p>
        </div>
      ) : tab === 'gaps' ? (
        <CanonGapList rows={gapRows} />
      ) : tab === 'drafts' ? (
        <CanonDraftList drafts={(rows ?? []) as never} />
      ) : (
        <CanonActiveList rows={(rows ?? []) as never} tab={tab} />
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
