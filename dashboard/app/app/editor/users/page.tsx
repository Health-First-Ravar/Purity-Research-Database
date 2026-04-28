// User management — invite new users, change roles, see last sign-in.
// Editor only.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { UsersClient } from './_components/UsersClient';
import { isAdmin } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users · Purity Dashboard' };

export default async function UsersPage() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/editor/users');

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!isAdmin(profile?.role)) {
    return <p className="text-sm text-purity-rust">Editor role required.</p>;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-serif text-2xl">Users</h1>
        <p className="mt-1 text-sm text-purity-muted dark:text-purity-mist">
          Invite Ildi, contractors, or anyone else who needs access. Editors see everything;
          users see only their own chat history and can&apos;t reach the editor surfaces.
        </p>
      </header>
      <UsersClient currentUserId={auth.user.id} />
    </div>
  );
}
