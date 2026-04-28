import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { LabelButtons } from './_components/LabelButtons';
import { EscalationTimeline } from './_components/EscalationTimeline';
import { EmptyState } from '../_components/EmptyState';
import { relativeTime, absoluteTime } from '@/lib/relative-time';
import { hasElevatedAccess } from '@/lib/auth-roles';

// Editor review queue. Two panes:
//   1. Escalated messages (insufficient_evidence OR confidence < floor)
//   2. Recent messages — editors can label good/bad/promote, improving retrieval
//
// Pagination: cursor-based via created_at. Load-more appends a next page by
// passing escalated_before / recent_before search params.

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type Params = {
  escalated_before?: string;
  recent_before?: string;
};

export default async function EditorPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return <p className="text-sm text-purity-muted dark:text-purity-mist">Sign in to access the editor queue.</p>;
  }
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) {
    return <p className="text-sm text-purity-rust">Editor role required.</p>;
  }

  // Count badges (cheap)
  const [{ count: escTotal }, { count: recentTotal }] = await Promise.all([
    supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('escalated', true).is('editor_label', null),
    supabase.from('messages').select('id', { count: 'exact', head: true }),
  ]);

  // Escalated queue
  let escalatedQ = supabase
    .from('messages')
    .select('id, question, answer, confidence_score, insufficient_evidence, escalation_reason, classification, created_at, editor_label')
    .eq('escalated', true)
    .is('editor_label', null)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (params.escalated_before) escalatedQ = escalatedQ.lt('created_at', params.escalated_before);
  const { data: escalated } = await escalatedQ;

  // Recent queue
  let recentQ = supabase
    .from('messages')
    .select('id, question, answer, confidence_score, classification, escalated, editor_label, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (params.recent_before) recentQ = recentQ.lt('created_at', params.recent_before);
  const { data: recent } = await recentQ;

  const escalatedRows = escalated ?? [];
  const recentRows = recent ?? [];
  const escalatedCursor = escalatedRows.length === PAGE_SIZE ? escalatedRows[escalatedRows.length - 1].created_at : null;
  const recentCursor = recentRows.length === PAGE_SIZE ? recentRows[recentRows.length - 1].created_at : null;

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-3 flex items-center gap-3">
          <h1 className="font-serif text-2xl">Editor — Escalation queue</h1>
          {(escTotal ?? 0) > 0 && (
            <span className="rounded-full bg-purity-rust/15 px-2.5 py-0.5 text-xs font-medium text-purity-rust">
              {escTotal} pending
            </span>
          )}
        </div>
        <p className="mb-4 text-sm text-purity-muted dark:text-purity-mist">
          Messages where the assistant flagged insufficient evidence or confidence fell below
          threshold. Answer directly, or promote a corrected version to canon.
        </p>
        <Queue
          rows={escalatedRows}
          emptyMsg="No escalations. Nice."
          loadMoreHref={escalatedCursor ? `?escalated_before=${encodeURIComponent(escalatedCursor)}` : null}
          preserveParam={params.recent_before ? `&recent_before=${encodeURIComponent(params.recent_before)}` : ''}
        />
      </section>

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h1 className="font-serif text-2xl">Recent messages</h1>
          {(recentTotal ?? 0) > 0 && (
            <span className="rounded-full bg-purity-bean/10 px-2.5 py-0.5 text-xs font-medium text-purity-muted dark:bg-purity-paper/10 dark:text-purity-mist">
              {recentTotal} total
            </span>
          )}
        </div>
        <p className="mb-4 text-sm text-purity-muted dark:text-purity-mist">
          Label good / bad to improve retrieval over time. Promote clean answers to canon.
        </p>
        <Queue
          rows={recentRows}
          emptyMsg="No messages yet."
          loadMoreHref={recentCursor ? `?recent_before=${encodeURIComponent(recentCursor)}` : null}
          preserveParam={params.escalated_before ? `&escalated_before=${encodeURIComponent(params.escalated_before)}` : ''}
        />
      </section>
    </div>
  );
}

type Row = {
  id: string;
  question: string;
  answer: string | null;
  confidence_score: number | null;
  classification?: string | null;
  escalation_reason?: string | null;
  insufficient_evidence?: boolean | null;
  escalated?: boolean | null;
  editor_label?: string | null;
  created_at: string;
};

function Queue({
  rows,
  emptyMsg,
  loadMoreHref,
  preserveParam,
}: {
  rows: Row[];
  emptyMsg: string;
  loadMoreHref: string | null;
  preserveParam: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        tone="success"
        title={emptyMsg}
        body="When a new escalation or unlabeled message appears it'll show up here."
      />
    );
  }
  return (
    <div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
            <div className="mb-1 flex flex-wrap gap-2 text-xs text-purity-muted dark:text-purity-mist">
              <span title={absoluteTime(r.created_at)}>{relativeTime(r.created_at)}</span>
              {r.classification && <span>· {r.classification}</span>}
              {typeof r.confidence_score === 'number' && <span>· conf {r.confidence_score.toFixed(2)}</span>}
              {r.escalated && <span className="text-purity-rust">· escalated{r.escalation_reason ? ` (${r.escalation_reason})` : ''}</span>}
              {r.editor_label && <span className="text-purity-green dark:text-purity-aqua">· labeled {r.editor_label}</span>}
            </div>
            <div className="font-medium">Q: {r.question}</div>
            <div className="mt-1 whitespace-pre-wrap text-purity-bean/90 dark:text-purity-paper/90">A: {r.answer ?? '(none)'}</div>
            <div className="mt-3">
              <LabelButtons messageId={r.id} />
            </div>
            <EscalationTimeline messageId={r.id} />
          </li>
        ))}
      </ul>
      {loadMoreHref && (
        <div className="mt-4 flex justify-center">
          <a
            href={loadMoreHref + preserveParam}
            className="rounded-md border border-purity-bean/20 px-4 py-2 text-sm text-purity-muted transition hover:border-purity-green hover:text-purity-green dark:border-purity-paper/20 dark:text-purity-mist dark:hover:border-purity-aqua dark:hover:text-purity-aqua"
          >
            Load more
          </a>
        </div>
      )}
    </div>
  );
}
