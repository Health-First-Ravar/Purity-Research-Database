// /reva/[session] — single Reva session. Server-loads sidebar + thread,
// hands the chat thread to the RevaChat client component.

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { SessionSidebar, type SessionRow } from '../_components/SessionSidebar';
import { RevaChat, type RevaMessage } from '../_components/RevaChat';

export const dynamic = 'force-dynamic';

export default async function RevaSessionPage({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params;
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return <p className="text-sm text-purity-muted">Sign in.</p>;
  const { data: profile } = await sb.from('profiles').select('role').eq('id', auth.user.id).single();
  if (profile?.role !== 'editor') {
    return <p className="text-sm text-purity-rust">Reva is editor-only.</p>;
  }

  const { data: sessRow } = await sb
    .from('reva_sessions')
    .select('id, title, default_mode, pinned, archived, created_at, updated_at')
    .eq('id', session)
    .eq('user_id', auth.user.id)
    .single();
  if (!sessRow) notFound();

  const { data: sessRows } = await sb
    .from('reva_sessions')
    .select('id, title, default_mode, pinned, archived, created_at, updated_at')
    .eq('user_id', auth.user.id)
    .eq('archived', false)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(100);
  const sessions: SessionRow[] = sessRows ?? [];

  const { data: msgRows } = await sb
    .from('reva_messages')
    .select('id, role, mode, content, cited_chunk_ids, flags, created_at, latency_ms, cost_usd')
    .eq('session_id', session)
    .order('created_at', { ascending: true });

  const initial: RevaMessage[] = (msgRows ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    mode: m.mode ?? null,
    content: m.content,
    cited_chunks: [],   // populated on next turn; historical citations skip detail render
    flags: m.flags as RevaMessage['flags'],
    created_at: m.created_at,
    latency_ms: m.latency_ms,
    cost_usd: m.cost_usd,
  }));

  return (
    <div className="grid h-[calc(100vh-200px)] gap-4 md:grid-cols-[260px_1fr]">
      <SessionSidebar sessions={sessions} active={sessRow.id} />
      <RevaChat
        sessionId={sessRow.id}
        title={sessRow.title}
        defaultMode={sessRow.default_mode as 'create' | 'analyze' | 'challenge'}
        initial={initial}
      />
    </div>
  );
}
