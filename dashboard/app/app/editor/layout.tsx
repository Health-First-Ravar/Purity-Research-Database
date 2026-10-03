import { AdminNav } from '../_components/SectionNavs';

export default function AdminSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
