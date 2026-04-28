// Knowledge Atlas — Health First Coffee at the core, branching outward across
// 12 curated taxonomies. Cross-branch links (the dashed ones) are the curated
// "this drives that" relationships maintained by editors.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';
import { AtlasClient } from './AtlasClient';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Knowledge Atlas · Purity Dashboard' };

export default async function AtlasPage() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/atlas');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  const isEditor = hasElevatedAccess(profile?.role);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-2xl">Knowledge Atlas</h1>
          <p className="text-sm text-purity-muted dark:text-purity-mist">
            Click a branch to expand its papers. Hover to light up cross-links.
            Drag to reposition (editors save the layout).
          </p>
        </div>
        {isEditor && (
          <Link
            href="/atlas/triage"
            className="rounded-md border border-purity-bean/20 px-3 py-1.5 text-xs text-purity-bean hover:bg-purity-cream dark:border-purity-paper/20 dark:text-purity-paper dark:hover:bg-purity-ink/40"
          >
            Triage →
          </Link>
        )}
      </div>
      <AtlasClient />
    </div>
  );
}
