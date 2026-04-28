'use client';

import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const sb = supabaseBrowser();
    await sb.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="rounded-md border border-purity-bean/20 px-3 py-1.5 text-xs text-purity-muted transition hover:border-purity-rust hover:text-purity-rust dark:border-purity-paper/20 dark:text-purity-mist"
      aria-label="Sign out"
    >
      Sign out
    </button>
  );
}
