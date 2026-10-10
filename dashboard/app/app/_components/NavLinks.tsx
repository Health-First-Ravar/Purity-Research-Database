'use client';

// Top nav: the Research Hub's five areas plus Home. Admin is staff only; each
// area's own section tabs (Claims, Research library, Admin) live in the area.
// Each page still enforces its own access.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type Role = 'customer_service' | 'editor' | 'admin' | null;

type FlatItem  = { kind: 'item'; href: string; label: string; visibleTo: Exclude<Role, null>[] };
type GroupItem = { href: string; label: string; visibleTo?: Exclude<Role, null>[] };
type Group     = { kind: 'group'; label: string; items: GroupItem[]; visibleTo: Exclude<Role, null>[] };

const ALL: Exclude<Role, null>[]    = ['customer_service', 'editor', 'admin'];
const STAFF: Exclude<Role, null>[]  = ['editor', 'admin'];

const SECTIONS: (FlatItem | Group)[] = [
  { kind: 'item', href: '/',        label: 'Home',             visibleTo: ALL },
  { kind: 'item', href: '/ask',     label: 'Ask',              visibleTo: ALL },
  { kind: 'item', href: '/coa',     label: 'COA quick view',   visibleTo: ALL },
  { kind: 'item', href: '/claims',  label: 'Claims',           visibleTo: ALL },
  { kind: 'item', href: '/library', label: 'Research library', visibleTo: ALL },
  { kind: 'item', href: '/admin',   label: 'Admin',            visibleTo: STAFF },
];

// Admin's tabs cover pages that keep their old URLs for now.
const ADMIN_PATHS = ['/admin', '/editor', '/heatmap', '/metrics'];

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
      className="flex flex-wrap items-center text-sm"
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
  if (href === '/') return pathname === '/';
  if (href === '/admin') return ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  return pathname === href || pathname.startsWith(href + '/');
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="hub-tab"
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
        aria-current={containsActive ? 'page' : undefined}
        className="hub-tab flex items-center gap-1"
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
