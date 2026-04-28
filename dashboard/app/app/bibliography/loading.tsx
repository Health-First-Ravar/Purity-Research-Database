import { SkeletonTable } from '../_components/Skeleton';

export default function BibliographyLoading() {
  return (
    <div>
      <div className="mb-2 h-7 w-40 animate-pulse rounded bg-purity-bean/10" />
      <div className="mb-4 h-4 w-80 animate-pulse rounded bg-purity-bean/10" />
      <div className="grid gap-6 md:grid-cols-2">
        <SkeletonTable rows={8} cols={5} />
        <SkeletonTable rows={8} cols={3} />
      </div>
    </div>
  );
}
