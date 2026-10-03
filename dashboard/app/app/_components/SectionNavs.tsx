// Server-side section navs: resolve the viewer's role, then render the tabs
// they may use. Each page still enforces its own access; these only hide tabs.

import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { getHubRole, isStaffRole } from '@/lib/lab-data';
import { PathSubNav } from './PathSubNav';

async function role() {
  return (await getHubRole(supabaseServer(await cookies()))).role;
}

export async function AdminNav() {
  const r = await role();
  if (!isStaffRole(r)) return null;
  const items = [
    { href: '/admin', label: 'Overview' },
    { href: '/editor', label: 'Review queue' },
    { href: '/editor/canon', label: 'Canon answers' },
    { href: '/heatmap', label: 'Question trends' },
    { href: '/admin/sync', label: 'Sync status' },
    ...(r === 'admin' ? [{ href: '/metrics', label: 'Metrics' }, { href: '/editor/users', label: 'Users' }] : []),
  ];
  return <PathSubNav items={items} label="Admin" />;
}

export async function LibraryNav() {
  const r = await role();
  const items = [
    { href: '/library', label: 'Papers' },
    ...(isStaffRole(r) ? [{ href: '/library/topics', label: 'Browse by topic' }] : []),
  ];
  return <PathSubNav items={items} label="Research library" />;
}
