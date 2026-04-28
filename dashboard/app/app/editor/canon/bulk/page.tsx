// Bulk-add canon Q&A. Editor only. Server gate; client form.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';
import { BulkCanonForm } from './_components/BulkCanonForm';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

export default async function BulkCanonPage() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/editor/canon/bulk');

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', auth.user.id).single();
  if (!hasElevatedAccess(profile?.role)) {
    return <p className="text-sm text-purity-rust">Editor role required.</p>;
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-2xl">Bulk add canon</h1>
          <p className="mt-1 text-sm text-purity-muted dark:text-purity-mist">
            Paste many Q&amp;A pairs at once. Each gets embedded for canon-cache lookup.
          </p>
        </div>
        <Link href="/editor/canon" className="text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">
          ← back to canon
        </Link>
      </header>
      <BulkCanonForm />
    </div>
  );
}
