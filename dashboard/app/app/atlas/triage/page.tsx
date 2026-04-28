// /atlas/triage — editor-only: route unmapped topics, review cross-link candidates.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import Link from 'next/link';
import { TriageClient } from './TriageClient';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Atlas triage · Purity Dashboard' };

export default async function AtlasTriagePage() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/atlas/triage');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  if (!hasElevatedAccess(profile?.role)) redirect('/atlas');

  const { data: branches } = await supabase
    .from('kb_atlas_branches')
    .select('id, label, color')
    .order('display_order');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl">Atlas triage</h1>
          <p className="text-sm text-purity-muted dark:text-purity-mist">
            Route unmapped topics to their branch · review auto-discovered cross-link candidates.
          </p>
        </div>
        <Link href="/atlas" className="text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">
          ← back to atlas
        </Link>
      </div>
      <TriageClient branches={branches ?? []} />
    </div>
  );
}
