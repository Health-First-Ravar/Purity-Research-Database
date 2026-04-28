// /reva — Ask Reva landing. Editor-only.
// Lists sessions on the left; right column is a "new session" empty state.
// When a session is opened, route is /reva/[session].

import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { SessionSidebar, type SessionRow } from './_components/SessionSidebar';

export const dynamic = 'force-dynamic';

export default async function RevaIndex() {
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return <p className="text-sm text-purity-muted">Sign in.</p>;
  const { data: profile } = await sb.from('profiles').select('role').eq('id', auth.user.id).single();
  if (profile?.role !== 'editor') {
    return <p className="text-sm text-purity-rust">Reva is editor-only.</p>;
  }

  const { data: sessRows } = await sb
    .from('reva_sessions')
    .select('id, title, default_mode, pinned, archived, created_at, updated_at')
    .eq('user_id', auth.user.id)
    .eq('archived', false)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(100);

  const sessions: SessionRow[] = sessRows ?? [];

  // Auto-open the most recent session if there is one.
  if (sessions.length > 0) redirect(`/reva/${sessions[0].id}`);

  return (
    <div className="grid h-[calc(100vh-200px)] gap-4 md:grid-cols-[260px_1fr]">
      <SessionSidebar sessions={sessions} active={null} />
      <div className="flex items-center justify-center rounded-lg border border-dashed border-purity-bean/20 p-8 text-center text-sm text-purity-muted dark:border-purity-paper/20 dark:text-purity-mist">
        <div>
          <p className="mb-3 font-serif text-lg text-purity-bean dark:text-purity-paper">Welcome to Ask Reva.</p>
          <p>
            Start a new session from the sidebar. Pick a default mode (Create, Analyze, or Challenge);
            you can switch modes per turn once you're in.
          </p>
          <Link
            href="#"
            // The sidebar handles new-session creation; this is a fallback hint.
            className="mt-4 inline-block text-purity-green dark:text-purity-aqua"
          >
            ↑ New session is in the sidebar
          </Link>
        </div>
      </div>
    </div>
  );
}
