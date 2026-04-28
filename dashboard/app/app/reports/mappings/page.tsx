import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { MappingsClient, type Rule } from './MappingsClient';
import { hasElevatedAccess } from '@/lib/auth-roles';

export const dynamic = 'force-dynamic';

export default async function MappingsPage() {
  const supabase = supabaseServer(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/reports/mappings');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  if (!hasElevatedAccess(profile?.role)) {
    return (
      <div>
        <h1 className="mb-4 font-serif text-2xl">Mapping rules</h1>
        <p className="text-sm text-purity-muted dark:text-purity-mist">Editor role required.</p>
      </div>
    );
  }

  const { data: rules } = await supabase
    .from('coa_mapping_rules')
    .select('*')
    .order('priority', { ascending: true });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/reports" className="text-sm text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">
          ← Back to Reports
        </Link>
      </div>
      <h1 className="mb-2 font-serif text-2xl">COA mapping rules</h1>
      <p className="mb-6 max-w-prose text-sm text-purity-muted dark:text-purity-mist">
        Pattern-based assignment of origin and region to COA rows by matching coffee_name.
        Lower priority runs first; first match wins per field. Blend is intentionally excluded —
        blends are seasonal and assigned per-batch, not per-coffee.
      </p>
      <MappingsClient initial={(rules ?? []) as Rule[]} />
    </div>
  );
}
