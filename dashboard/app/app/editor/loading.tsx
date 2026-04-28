import { SkeletonBlock } from '../_components/Skeleton';

export default function EditorLoading() {
  return (
    <div className="space-y-10">
      <section>
        <div className="mb-3 h-7 w-64 animate-pulse rounded bg-purity-bean/10" />
        <SkeletonBlock rows={3} />
      </section>
      <section>
        <div className="mb-3 h-7 w-48 animate-pulse rounded bg-purity-bean/10" />
        <SkeletonBlock rows={3} />
      </section>
    </div>
  );
}
