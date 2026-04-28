import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-purity-bean/10 bg-white p-6 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
      <h1 className="mb-2 font-serif text-lg">Page not found</h1>
      <p className="mb-4 text-purity-muted dark:text-purity-mist">
        That URL doesn&apos;t match anything in the dashboard.
      </p>
      <Link
        href="/chat"
        className="rounded-md bg-purity-bean px-3 py-1.5 text-xs text-purity-cream dark:bg-purity-aqua dark:text-purity-ink"
      >
        Research Hub
      </Link>
    </div>
  );
}
