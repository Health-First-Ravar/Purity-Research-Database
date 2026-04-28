import { SkeletonBlock } from '../_components/Skeleton';

export default function ChatLoading() {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr,320px]">
      <section>
        <div className="mb-4 h-7 w-44 animate-pulse rounded bg-purity-bean/10" />
        <SkeletonBlock rows={4} />
      </section>
      <aside className="space-y-2">
        <div className="h-5 w-20 animate-pulse rounded bg-purity-bean/10" />
        <SkeletonBlock rows={3} />
      </aside>
    </div>
  );
}
