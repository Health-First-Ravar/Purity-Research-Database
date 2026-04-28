// /metrics — layperson-friendly system health.
// Plain English labels, status dots, an activity chart, engineering details
// tucked into a collapsible.

import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { ActivityChart, type ActivityRow } from './_components/ActivityChart';
import { Explainer } from './_components/Explainer';
import { EngineeringDetails } from './_components/EngineeringDetails';

export const dynamic = 'force-dynamic';

type DailyRow = {
  day: string;
  total_messages: number;
  canon_hits: number;
  llm_calls: number;
  escalations: number;
  thumbs_up: number;
  thumbs_down: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_confidence: number | null;
  total_cost_usd: number | null;
};

type Status = 'good' | 'watch' | 'attention' | 'neutral';

const STATUS_RULES = {
  escalationGood: 0.25,
  escalationWatch: 0.50,
  satisfactionGood: 0.80,
  satisfactionWatch: 0.60,
  canonGood: 0.30,
  canonWatch: 0.10,
  speedGoodMs: 4000,
  speedWatchMs: 8000,
};

function statusFromEscalation(rate: number | null): Status {
  if (rate == null) return 'neutral';
  if (rate <= STATUS_RULES.escalationGood) return 'good';
  if (rate <= STATUS_RULES.escalationWatch) return 'watch';
  return 'attention';
}
function statusFromSatisfaction(rate: number | null): Status {
  if (rate == null) return 'neutral';
  if (rate >= STATUS_RULES.satisfactionGood) return 'good';
  if (rate >= STATUS_RULES.satisfactionWatch) return 'watch';
  return 'attention';
}
function statusFromCanon(rate: number | null): Status {
  if (rate == null) return 'neutral';
  if (rate >= STATUS_RULES.canonGood) return 'good';
  if (rate >= STATUS_RULES.canonWatch) return 'watch';
  return 'neutral'; // early-system thinness shouldn't be flagged red
}
function statusFromSpeed(ms: number | null): Status {
  if (ms == null) return 'neutral';
  if (ms <= STATUS_RULES.speedGoodMs) return 'good';
  if (ms <= STATUS_RULES.speedWatchMs) return 'watch';
  return 'attention';
}

export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const days = Math.min(Math.max(Number(params.days ?? 30) || 30, 1), 365);

  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return <p className="text-sm text-purity-muted">Sign in to view metrics.</p>;
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (profile?.role !== 'editor') {
    return <p className="text-sm text-purity-rust">Editor role required.</p>;
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: dailyData } = await supabase
    .from('daily_chat_metrics')
    .select('*')
    .gte('day', since)
    .order('day', { ascending: false });
  const daily: DailyRow[] = dailyData ?? [];

  const [{ count: promoCount }, { count: missesCount }, { count: openEscCount }] = await Promise.all([
    supabase.from('promotion_candidates').select('message_id', { count: 'exact', head: true }),
    supabase.from('canon_misses').select('message_id', { count: 'exact', head: true }),
    supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('escalated', true).is('editor_label', null),
  ]);

  const totals = daily.reduce(
    (acc, d) => ({
      messages: acc.messages + (d.total_messages ?? 0),
      canon_hits: acc.canon_hits + (d.canon_hits ?? 0),
      escalations: acc.escalations + (d.escalations ?? 0),
      thumbs_up: acc.thumbs_up + (d.thumbs_up ?? 0),
      thumbs_down: acc.thumbs_down + (d.thumbs_down ?? 0),
      cost_usd: acc.cost_usd + Number(d.total_cost_usd ?? 0),
    }),
    { messages: 0, canon_hits: 0, escalations: 0, thumbs_up: 0, thumbs_down: 0, cost_usd: 0 },
  );
  const avgLatencyMs = (() => {
    const days = daily.filter((d) => d.avg_latency_ms != null);
    if (!days.length) return null;
    const sum = days.reduce((s, d) => s + Number(d.avg_latency_ms), 0);
    return Math.round(sum / days.length);
  })();

  const escRate = totals.messages ? totals.escalations / totals.messages : null;
  const answeredRate = escRate == null ? null : 1 - escRate;
  const canonRate = totals.messages ? totals.canon_hits / totals.messages : null;
  const thumbsTotal = totals.thumbs_up + totals.thumbs_down;
  const satisfactionRate = thumbsTotal ? totals.thumbs_up / thumbsTotal : null;

  const escStatus = statusFromEscalation(escRate);
  const satStatus = statusFromSatisfaction(satisfactionRate);
  const canonStatus = statusFromCanon(canonRate);
  const speedStatus = statusFromSpeed(avgLatencyMs);

  const summary = makeSummary({
    days,
    messages: totals.messages,
    escalated: totals.escalations,
    answeredRate,
    satisfactionRate,
  });

  const activityRows: ActivityRow[] = [...daily]
    .reverse()
    .map((d) => ({
      day: d.day,
      answered_in_chat: Math.max(0, (d.total_messages ?? 0) - (d.escalations ?? 0)),
      sent_to_person: d.escalations ?? 0,
      thumbs_up: d.thumbs_up ?? 0,
      thumbs_down: d.thumbs_down ?? 0,
    }));

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="font-serif text-2xl">Dashboard</h1>
          <p className="mt-1 font-serif text-base text-purity-bean/80 dark:text-purity-paper/80">
            {summary}
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm">
          <label htmlFor="metrics-window" className="text-purity-muted dark:text-purity-mist">window:</label>
          <select
            id="metrics-window"
            name="days"
            defaultValue={String(days)}
            className="rounded border border-purity-bean/20 bg-white px-2 py-1 dark:border-purity-paper/20 dark:bg-purity-shade dark:text-purity-paper"
          >
            <option value="7">last 7 days</option>
            <option value="30">last 30 days</option>
            <option value="90">last 90 days</option>
            <option value="365">last year</option>
          </select>
          <button className="rounded-md bg-purity-bean px-3 py-1 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink">Apply</button>
        </form>
      </header>

      {/* Three primary KPIs */}
      <section className="grid gap-3 sm:grid-cols-3">
        <BigTile
          label="Conversations"
          value={totals.messages.toLocaleString()}
          sub={`in the last ${days} days`}
          status="neutral"
        />
        <BigTile
          label="Answered confidently"
          value={answeredRate == null ? '—' : `${Math.round(answeredRate * 100)}%`}
          sub={escRate == null
            ? 'no traffic yet'
            : `${totals.escalations.toLocaleString()} of ${totals.messages.toLocaleString()} sent to Ildi or Jeremy`}
          status={escStatus}
        />
        <BigTile
          label="Customer satisfaction"
          value={satisfactionRate == null ? '—' : `${Math.round(satisfactionRate * 100)}%`}
          sub={thumbsTotal
            ? `${totals.thumbs_up}👍 / ${totals.thumbs_down}👎`
            : 'no thumbs ratings yet'}
          status={satStatus}
        />
      </section>

      {/* Activity chart */}
      <section>
        <h2 className="mb-2 font-serif text-lg">Activity over time</h2>
        <ActivityChart rows={activityRows} />
        <div className="mt-2 flex items-center gap-4 text-xs text-purity-muted dark:text-purity-mist">
          <Legend swatch="bg-purity-green dark:bg-purity-aqua" label="answered in chat" />
          <Legend swatch="bg-amber-500" label="sent to a person" />
        </div>
      </section>

      {/* Health strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SmallTile label="AI cost this period" value={`$${totals.cost_usd.toFixed(2)}`} />
        <SmallTile
          label="Average response time"
          value={avgLatencyMs == null ? '—' : `${(avgLatencyMs / 1000).toFixed(1)}s`}
          status={speedStatus}
          sub={speedStatus === 'attention' ? 'slower than target (4s)' : undefined}
        />
        <SmallTile
          label="Quick answers ready"
          value={canonRate == null ? '—' : `${Math.round(canonRate * 100)}%`}
          status={canonStatus}
          sub={`${totals.canon_hits} of ${totals.messages} from saved answers`}
        />
        <SmallTile
          label="Waiting on a person"
          value={(openEscCount ?? 0).toLocaleString()}
          sub={(openEscCount ?? 0) > 0 ? 'open escalations to review' : 'inbox clear'}
          status={(openEscCount ?? 0) > 5 ? 'attention' : (openEscCount ?? 0) > 0 ? 'watch' : 'good'}
        />
      </section>

      {/* Editor inbox helpers */}
      <section className="grid gap-3 sm:grid-cols-2">
        <SmallTile
          label="Good answers to save"
          value={(promoCount ?? 0).toLocaleString()}
          sub="thumbs-up answers worth promoting to canon"
        />
        <SmallTile
          label="Answers that need work"
          value={(missesCount ?? 0).toLocaleString()}
          sub="thumbs-down + escalations to triage"
          status={(missesCount ?? 0) > 10 ? 'watch' : 'neutral'}
        />
      </section>

      <Explainer />
      <EngineeringDetails daily={daily} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function BigTile({
  label,
  value,
  sub,
  status,
}: {
  label: string;
  value: string;
  sub?: string;
  status: Status;
}) {
  return (
    <div className="rounded-lg border border-purity-bean/10 bg-white p-5 dark:border-purity-paper/10 dark:bg-purity-shade">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-purity-muted dark:text-purity-mist">
        <StatusDot status={status} />
        {label}
      </div>
      <div className="mt-2 font-serif text-3xl text-purity-bean dark:text-purity-paper">{value}</div>
      {sub && <div className="mt-1 text-xs text-purity-muted dark:text-purity-mist">{sub}</div>}
    </div>
  );
}

function SmallTile({
  label,
  value,
  sub,
  status = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  status?: Status;
}) {
  return (
    <div className="rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-purity-muted dark:text-purity-mist">
        <StatusDot status={status} />
        {label}
      </div>
      <div className="mt-1 font-serif text-xl text-purity-bean dark:text-purity-paper">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-purity-muted dark:text-purity-mist">{sub}</div>}
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const cls =
    status === 'good'
      ? 'bg-purity-green dark:bg-purity-aqua'
      : status === 'watch'
        ? 'bg-amber-500'
        : status === 'attention'
          ? 'bg-purity-rust'
          : 'bg-purity-bean/20 dark:bg-purity-paper/20';
  const label =
    status === 'good' ? 'healthy'
    : status === 'watch' ? 'watch this'
    : status === 'attention' ? 'needs attention'
    : 'neutral';
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} aria-label={label} />;
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded ${swatch}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// One-line summary in serif at the top.
// ---------------------------------------------------------------------------
function makeSummary(args: {
  days: number;
  messages: number;
  escalated: number;
  answeredRate: number | null;
  satisfactionRate: number | null;
}): string {
  const { days, messages, escalated, answeredRate, satisfactionRate } = args;
  if (messages === 0) {
    return `Nothing has come through the chat in the last ${days} days yet. Once people start asking questions, you'll see how the system is doing here.`;
  }
  const window = days === 30 ? 'this month'
    : days === 7 ? 'this week'
    : days === 365 ? 'this year'
    : `over the last ${days} days`;
  const ans = answeredRate == null ? '' :
    `Reva handled ${Math.round(answeredRate * 100)}% in chat; ${escalated} of ${messages} needed Ildi or Jeremy to step in.`;
  const sat = satisfactionRate == null
    ? 'No customer ratings yet — that data starts populating as people use the thumbs buttons.'
    : `Customer satisfaction is sitting at ${Math.round(satisfactionRate * 100)}%.`;
  return `${messages} ${messages === 1 ? 'conversation' : 'conversations'} ${window}. ${ans} ${sat}`.trim();
}
