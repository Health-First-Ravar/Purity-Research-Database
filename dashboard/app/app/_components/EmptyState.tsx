// Reusable empty-state component. Used by pages that render a list
// or grid that might have zero rows. Keeps the layout stable and gives
// the user a next action instead of an awkward gap.

import Link from 'next/link';

type Action = { label: string; href?: string; onClick?: () => void };

export function EmptyState({
  title,
  body,
  action,
  tone = 'neutral',
}: {
  title: string;
  body?: React.ReactNode;
  action?: Action;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const toneCls =
    tone === 'success'
      ? 'border-purity-green/20 bg-purity-green/5 dark:border-purity-aqua/25 dark:bg-purity-aqua/5'
      : tone === 'warning'
        ? 'border-purity-rust/20 bg-purity-rust/5 dark:border-purity-rust/30 dark:bg-purity-rust/10'
        : 'border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade';
  return (
    <div className={'rounded-lg border p-6 text-center ' + toneCls}>
      <h3 className="mb-1 font-serif text-base">{title}</h3>
      {body && <p className="mx-auto max-w-md text-sm text-purity-muted dark:text-purity-mist">{body}</p>}
      {action && (
        <div className="mt-4">
          {action.href ? (
            <Link href={action.href} className="rounded-md bg-purity-bean px-3 py-1.5 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink">
              {action.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="rounded-md bg-purity-bean px-3 py-1.5 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
