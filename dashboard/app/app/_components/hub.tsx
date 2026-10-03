// Shared Research Hub building blocks, styled after Brian's Lab Testing tracker.
import Link from 'next/link';
import { SEV_COLOR, type Attention } from '@/lib/lab-data';

export function Card({ title, hint, children, id, className = '' }: { title?: string; hint?: React.ReactNode; children: React.ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={`hub-card ${className}`}>
      {title && <h2>{title}</h2>}
      {hint && <p className="hub-hint">{hint}</p>}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, alert }: { label: string; value: React.ReactNode; sub?: string; alert?: boolean }) {
  return (
    <div className={`hub-kpi${alert ? ' alert' : ''}`}>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

export function AttentionList({ items, limit }: { items: Attention[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  if (!shown.length) return <p className="text-sm text-purity-muted dark:text-purity-mist">Nothing needs attention.</p>;
  return (
    <div className="grid gap-2.5">
      {shown.map((i, n) => {
        const body = (
          <>
            <div className="bar" style={{ background: SEV_COLOR[i.sev] }} />
            <div>
              <h3 className="mb-0.5 text-[0.95rem] font-semibold">{i.title}</h3>
              <p className="text-sm text-purity-muted dark:text-purity-mist">{i.detail}</p>
            </div>
          </>
        );
        return i.href
          ? <Link key={n} href={i.href} className="hub-attn hover:ring-1 hover:ring-purity-aqua">{body}</Link>
          : <div key={n} className="hub-attn">{body}</div>;
      })}
    </div>
  );
}

export function SubNav({ items, current }: { items: { href: string; label: string }[]; current: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1.5 no-print" aria-label="Section">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.href === current ? 'page' : undefined}
          className={
            'rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ' +
            (i.href === current
              ? 'border-purity-teal bg-purity-teal text-white dark:border-purity-glow dark:bg-purity-glow dark:text-purity-ink'
              : 'border-purity-line bg-purity-card text-purity-muted hover:text-purity-teal dark:border-purity-rule dark:bg-purity-shade dark:text-purity-mist')
          }
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function coaSubNav(staff: boolean) {
  return [
    { href: '/coa', label: 'Overview' },
    ...(staff ? [{ href: '/coa/green', label: 'Green lots' }] : []),
    { href: '/coa/standard', label: 'Health Grade standard' },
    { href: '/coa/how', label: 'How we test' },
  ];
}

export const claimsSubNav = [
  { href: '/claims', label: 'Claim library' },
  { href: '/claims/check', label: 'Check a claim' },
];

export function TrackerNote({ syncedAt }: { syncedAt: string | null }) {
  return (
    <p className="mt-6 text-xs text-purity-muted dark:text-purity-mist">
      COA data mirrors Brian&apos;s Lab Testing tracker{syncedAt ? `, last synced ${new Date(syncedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })} ET` : ''}.
      {' '}Statuses use his tracker&apos;s rules. Full records:{' '}
      <a className="underline" href="https://claude.ai/artifact/VFhgxKpr4GCMAQ3RiRPBgr" target="_blank" rel="noopener noreferrer">Brian&apos;s tracker</a>.
    </p>
  );
}
