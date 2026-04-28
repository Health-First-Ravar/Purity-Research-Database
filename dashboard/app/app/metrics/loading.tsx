import { SkeletonTable } from '../_components/Skeleton';

export default function MetricsLoading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 h-7 w-56 animate-pulse rounded bg-purity-bean/10" />
        <div className="h-4 w-80 animate-pulse rounded bg-purity-bean/10" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-purity-bean/10 bg-white p-4">
            <div className="h-3 w-24 animate-pulse rounded bg-purity-bean/10" />
            <div className="mt-2 h-7 w-20 animate-pulse rounded bg-purity-bean/10" />
          </div>
        ))}
      </div>
      <SkeletonTable rows={10} cols={10} />
    </div>
  );
}
