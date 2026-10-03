import { LibraryNav } from '../_components/SectionNavs';

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LibraryNav />
      {children}
    </>
  );
}
