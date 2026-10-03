'use client';

// Section tabs that highlight from the current path, for section layouts that
// wrap several existing pages (Research library, Admin). The longest matching
// href wins, so /editor/canon highlights Canon rather than Review queue.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type SectionItem = { href: string; label: string };

export function PathSubNav({ items, label }: { items: SectionItem[]; label: string }) {
  const pathname = usePathname() ?? '';
  if (items.length < 2) return null;
  const current = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="mb-4 flex flex-wrap gap-1.5 no-print" aria-label={label}>
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
