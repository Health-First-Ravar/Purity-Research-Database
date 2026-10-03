// Ask: server-component shell that role-gates and renders the client chat UI.
// Everyone with a role can use it (Research Hub overhaul); deep mode (Reva) is
// linked for admins only.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { canChat, isAdmin } from '@/lib/auth-roles';
import ChatClient from './_components/ChatClient';

export const dynamic = 'force-dynamic';

export default async function ResearchHubPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/chat');

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!canChat(profile?.role)) {
    // No recognised role: nothing here they may use.
    redirect('/');
  }

  // The intro copy used to hardcode "34 research papers" — the count from
  // knowledge-base/README.md for the research/ folder, not the count of what
  // this box actually searches. It understated the corpus by ~46x and would
  // drift again the moment the next sync lands. Read it live instead.
  //
  // bibliography_view, not `sources`: papers are deliberately ingested under
  // several chapter folders (see CLAUDE.md), so a raw sources count
  // double-counts. The view is DOI-deduped, which is the honest "papers" number.
  const { count: paperCount } = await supabase
    .from('bibliography_view')
    .select('*', { count: 'exact', head: true });

  return (
    <ChatClient
      paperCount={paperCount ?? null}
      initialQuestion={typeof q === 'string' ? q.slice(0, 500) : ''}
      deepMode={isAdmin(profile?.role)}
    />
  );
}
