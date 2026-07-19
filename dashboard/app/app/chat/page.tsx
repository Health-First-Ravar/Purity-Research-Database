// Research Hub — server-component shell that role-gates and renders the
// client chat UI. Customer service + admin can use this; editor cannot
// (editor is back-office, not customer-facing).

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { canChat } from '@/lib/auth-roles';
import ChatClient from './_components/ChatClient';

export const dynamic = 'force-dynamic';

export default async function ResearchHubPage() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/chat');

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!canChat(profile?.role)) {
    // Editor lands here. Send them to a surface they actually have access to.
    redirect('/editor');
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

  return <ChatClient paperCount={paperCount ?? null} />;
}
