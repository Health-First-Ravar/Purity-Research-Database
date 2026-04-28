// Small visual primitives for loading states. No animation library —
// just a Tailwind pulse.

export function SkeletonLine({ w = 'w-full' }: { w?: string }) {
  return <div className={'h-3 animate-pulse rounded bg-purity-bean/10 dark:bg-purity-paper/10 ' + w} />;
}

export function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-lg border border-purity-bean/10 bg-white p-4 dark:border-purity-paper/10 dark:bg-purity-shade">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine key={i} w={i % 3 === 0 ? 'w-1/2' : i % 3 === 1 ? 'w-5/6' : 'w-4/6'} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-lg border border-purity-bean/10 bg-white p-2 dark:border-purity-paper/10 dark:bg-purity-shade">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 border-b border-purity-bean/5 px-2 py-2 last:border-b-0 dark:border-purity-paper/5">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className={
                'h-3 animate-pulse rounded bg-purity-bean/10 dark:bg-purity-paper/10 ' +
                (c === 1 ? 'flex-1' : c === 0 ? 'w-14' : 'w-20')
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
