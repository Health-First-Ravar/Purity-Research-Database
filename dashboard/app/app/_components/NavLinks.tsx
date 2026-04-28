'use client';

// Top-nav with role-based visibility and three click-to-open groups:
//   Customer Questions  — heatmap, canon, editor queue
//   Research            — ask reva (admin only), bibliography, atlas
//   Admin               — metrics, users
//
// Three flat top-level items: Research Hub (chat), Reports, Audit.
// Each role sees only what they're entitled to.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type Role = 'customer_service' | 'editor' | 'admin' | null;

type FlatItem  = { kind: 'item'; href: string; label: string; visibleTo: Exclude<Role, null>[] };
type GroupItem = { href: string; label: string; visibleTo?: Exclude<Role, null>[] };
type Group     = { kind: 'group'; label: string; items: GroupItem[]; visibleTo: Exclude<Role, null>[] };

const ALL: Exclude<Role, null>[]    = ['customer_service', 'editor', 'admin'];
const STAFF: Exclude<Role, null>[]  = ['editor', 'admin'];
const CHAT_OK: Exclude<Role, null>[] = ['customer_service', 'admin'];
const ADMIN: Exclude<Role, null>[]  = ['admin'];

const SECTIONS: (FlatItem | Group)[] = [
  { kind: 'item', href: '/chat',         label: 'Research Hub', visibleTo: CHAT_OK },
  { kind: 'item', href: '/reports',      label: 'Reports',      visibleTo: ALL },
  { kind: 'item', href: '/audit',        label: 'Audit',        visibleTo: ALL },
  {
    kind: 'group',
    label: 'Customer Questions',
    visibleTo: STAFF,
    items: [
      { href: '/heatmap',      label: 'Heatmap' },
      { href: '/editor/canon', label: 'Canon' },
      { href: '/editor',       label: 'Editor queue' },
    ],
  },
  {
    kind: 'group',
    label: 'Research',
    visibleTo: STAFF,
    items: [
      { href: '/reva',         label: 'Ask Reva',     visibleTo: ADMIN },
      { href: '/bibliography', label: 'Bibliography' },
      { href: '/atlas',        label: 'Atlas' },
    ],
  },
  // Bibliography also flat for customer_service (no Research group for them).
  { kind: 'item', href: '/bibliography', label: 'Bibliography', visibleTo: ['customer_service'] },
  {
    kind: 'group',
    label: 'Admin',
    visibleTo: ADMIN,
    items: [
      { href: '/metrics',      label: 'Metrics' },
      { href: '/editor/users', label: 'Users' },
    ],
  },
];

export function NavLinks({ role }: { role: Role }) {
  const pathname = usePathname() ?? '';

  // For unauthenticated requests we render nothing — the layout still renders
  // the brand mark + sign-in path.
  if (!role) return null;

  const visibleSections = SECTIONS
    .filter((s) => s.visibleTo.includes(role))
    .map((s) => {
      if (s.kind !== 'group') return s;
      const items = s.items.filter((i) => !i.visibleTo || i.visibleTo.includes(role));
      return items.length ? { ...s, items } : null;
    })
    .filter(Boolean) as (FlatItem | Group)[];

  return (
    <nav
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1 text-sm sm:gap-x-5"
      aria-label="Primary"
    >
      {visibleSections.map((s) => {
        if (s.kind === 'item') {
          const active = isActive(pathname, s.href);
          return <NavLink key={s.href} href={s.href} label={s.label} active={active} />;
        }
        return <NavGroup key={s.label} group={s} pathname={pathname} />;
      })}
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        'relative shrink-0 py-1 transition ' +
        (active
          ? 'font-medium text-purity-green after:absolute after:inset-x-0 after:-bottom-[13px] after:h-[2px] after:bg-purity-green dark:text-purity-aqua dark:after:bg-purity-aqua'
          : 'text-purity-bean/80 hover:text-purity-green dark:text-purity-paper/80 dark:hover:text-purity-aqua')
      }
    >
      {label}
    </Link>
  );
}

function NavGroup({ group, pathname }: { group: Group; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const containsActive = group.items.some((i) => isActive(pathname, i.href));

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          'relative flex shrink-0 items-center gap-1 py-1 transition ' +
          (containsActive
            ? 'font-medium text-purity-green after:absolute after:inset-x-0 after:-bottom-[13px] after:h-[2px] after:bg-purity-green dark:text-purity-aqua dark:after:bg-purity-aqua'
            : 'text-purity-bean/80 hover:text-purity-green dark:text-purity-paper/80 dark:hover:text-purity-aqua')
        }
      >
        {group.label}
        <span className={'inline-block text-[9px] transition-transform ' + (open ? 'rotate-180' : '')}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-2 min-w-[180px] rounded-md border border-purity-bean/15 bg-white p-1 shadow-lg dark:border-purity-paper/15 dark:bg-purity-shade"
        >
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={
                  'block rounded px-3 py-1.5 text-sm transition ' +
                  (active
                    ? 'bg-purity-green/10 font-medium text-purity-green dark:bg-purity-aqua/10 dark:text-purity-aqua'
                    : 'text-purity-bean hover:bg-purity-cream dark:text-purity-paper dark:hover:bg-purity-ink/40')
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
