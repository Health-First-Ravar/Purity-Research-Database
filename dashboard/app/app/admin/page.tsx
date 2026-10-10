// Admin overview: where staff work the review queue, watch question trends and
// sync health, and (admins) manage users. The old pages (Reports, Assign
// products, Limits) were retired at the switch-over; next.config.ts redirects
// their URLs.

import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { getHubRole, isStaffRole, niceDate } from '@/lib/lab-data';
import { Card, Kpi, KpiRow } from '../_components/hub';
import { lastSyncHealth, type SyncRun } from './sync/health';

export const dynamic = 'force-dynamic';

const TOOLS: { href: string; label: string; what: string; admin?: boolean }[] = [
  { href: '/editor', label: 'Review queue', what: 'Escalated Ask answers waiting for Ildi or Jeremy, and recent messages.' },
  { href: '/editor/canon', label: 'Canon answers', what: 'Curated answers Ask reuses; Claude drafts, you approve.' },
  { href: '/heatmap', label: 'Question trends', what: 'What people ask about, by topic and over time.' },
  { href: '/admin/sync', label: 'Sync status', what: "Every import from Brian's tracker, with its validation result." },
  { href: '/metrics', label: 'Metrics', what: 'Usage, escalation rate, answer time and cost.', admin: true },
  { href: '/editor/users', label: 'Users', what: 'Accounts and roles.', admin: true },
  { href: '/reva', label: 'Ask deep mode (Reva)', what: 'Long-form analysis with the full research stack.', admin: true },
];

export default async function AdminPage() {
  const sb = supabaseServer(await cookies());
  const { userId, role } = await getHubRole(sb);
  if (!userId) redirect('/login?next=/admin');
  if (!isStaffRole(role)) redirect('/');
  const admin = role === 'admin';

  const [{ data: runs }, { count: escalated }, { count: openEsc }, { count: checked }] = await Promise.all([
    sb.from('sync_runs').select('id, snapshot_id, taken_at, imported_at, records, claims, status, detail').order('imported_at', { ascending: false }).limit(5),
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('escalated', true).gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString()),
    // Same count as the Review queue and Metrics: escalated and not yet labelled, any date.
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('escalated', true).is('editor_label', null),
    sb.from('lab_claims').select('id', { count: 'exact', head: true }).not('research_verdict', 'is', null),
  ]);
  const health = lastSyncHealth((runs ?? []) as SyncRun[]);

  return (
    <div className="grid gap-4">
      <KpiRow>
        <Kpi label="Last sync" value={health.lastOk ? niceDate(health.lastOk.imported_at.slice(0, 10), false) : 'None'} sub={health.message} alert={health.stale} />
        <Kpi label="Lab records" value={health.lastOk?.records ?? '—'} sub="in the last import" />
        <Kpi label="Review queue" value={openEsc ?? '—'} sub={`escalations not yet reviewed (any date) · ${escalated ?? 0} new in the last 30 days`} alert={(openEsc ?? 0) > 0} />
        <Kpi label="Claims checked" value={checked ?? 0} sub="research verdicts saved" />
      </KpiRow>

      <Card title="Tools">
        <ul className="grid gap-2 sm:grid-cols-2">
          {TOOLS.filter((t) => admin || !t.admin).map((t) => (
            <li key={t.href}>
              <Link href={t.href} className="hub-attn block px-4 hover:ring-1 hover:ring-purity-aqua" style={{ gridTemplateColumns: '1fr' }}>
                <div>
                  <h3 className="text-[0.95rem] font-semibold text-purity-teal dark:text-purity-glow">{t.label}</h3>
                  <p className="text-sm text-purity-muted dark:text-purity-mist">{t.what}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
