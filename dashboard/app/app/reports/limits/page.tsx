// /reports/limits — admin-only editable table of analyte thresholds.
// The limits feed every COA detail page evaluation and the Reports list
// coloring. Edits here propagate via the 30s cache TTL (or instantly when
// `bustLimitsCache` is called from the API layer after a write).

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';
import { isAdmin } from '@/lib/auth-roles';
import { LimitsClient } from './_components/LimitsClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'COA Limits · Purity Dashboard' };

export default async function LimitsPage() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/reports/limits');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  if (!isAdmin(profile?.role)) {
    return <p className="text-sm text-purity-rust">Admin role required.</p>;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">COA limits</h1>
          <p className="mt-1 text-sm text-purity-muted dark:text-purity-mist">
            The strictest publicly published threshold per analyte. These power the red/gray
            coloring on every COA report and the over/under tags on detail pages. Edits here
            apply within 30 seconds across the whole dashboard.
          </p>
        </div>
        <Link href="/reports" className="text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">
          ← back to Reports
        </Link>
      </header>
      <LimitsClient />
    </div>
  );
}
