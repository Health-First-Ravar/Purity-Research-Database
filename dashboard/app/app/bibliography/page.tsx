// Bibliography is now the Research library (Research Hub overhaul).
import { redirect } from 'next/navigation';

export default async function BibliographyRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') sp.set(k, v);
  redirect(`/library${sp.toString() ? `?${sp}` : ''}`);
}
