// Server-rendered timeline of escalation events for a message.
// Small, read-only. Pulls from escalation_events joined against profiles.

import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { relativeTime, absoluteTime } from '@/lib/relative-time';

type Event = {
  id: string;
  event_type: string;
  actor_id: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  canon_id: string | null;
  created_at: string;
};

const LABEL: Record<string, string> = {
  escalated: 'escalated',
  claimed: 'claimed',
  labeled: 'labeled',
  promoted: 'promoted to canon',
  reopened: 'reopened',
  resolved: 'resolved',
  note: 'note',
};

const TONE: Record<string, string> = {
  escalated: 'text-purity-rust',
  claimed: 'text-purity-muted dark:text-purity-mist',
  labeled: 'text-purity-bean dark:text-purity-paper',
  promoted: 'text-purity-green dark:text-purity-aqua',
  reopened: 'text-purity-rust',
  resolved: 'text-purity-green dark:text-purity-aqua',
  note: 'text-purity-muted dark:text-purity-mist',
};

export async function EscalationTimeline({ messageId }: { messageId: string }) {
  const supabase = supabaseServer(await cookies());

  const { data: eventsRaw } = await supabase
    .from('escalation_events')
    .select('id, event_type, actor_id, old_value, new_value, note, canon_id, created_at')
    .eq('message_id', messageId)
    .order('created_at', { ascending: true });

  const events: Event[] = eventsRaw ?? [];
  if (events.length === 0) return null;

  const actorIds = Array.from(new Set(events.map((e) => e.actor_id).filter(Boolean))) as string[];
  const actorMap: Record<string, string> = {};
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', actorIds);
    for (const p of profiles ?? []) actorMap[p.id] = p.full_name ?? p.email;
  }

  return (
    <details className="mt-2 rounded border border-purity-bean/10 bg-purity-cream/50 text-xs dark:border-purity-paper/10 dark:bg-purity-ink/50">
      <summary className="cursor-pointer px-2 py-1 text-purity-muted dark:text-purity-mist">
        Audit trail ({events.length} {events.length === 1 ? 'event' : 'events'})
      </summary>
      <ul className="space-y-1 px-2 pb-2 pt-1">
        {events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span
              className="w-28 shrink-0 font-mono text-purity-muted dark:text-purity-mist"
              title={absoluteTime(e.created_at)}
            >
              {relativeTime(e.created_at)}
            </span>
            <span className={'w-28 shrink-0 ' + (TONE[e.event_type] ?? '')}>
              {LABEL[e.event_type] ?? e.event_type}
            </span>
            <span className="text-purity-bean/80 dark:text-purity-paper/80">
              {e.actor_id ? (actorMap[e.actor_id] ?? 'editor') : 'system'}
              {e.old_value !== null && e.new_value !== null && e.old_value !== e.new_value && (
                <> · {e.old_value ?? '∅'} → {e.new_value ?? '∅'}</>
              )}
              {e.new_value !== null && e.old_value === null && e.event_type !== 'claimed' && (
                <> · {e.new_value}</>
              )}
              {e.note && <> · <em>{e.note}</em></>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
