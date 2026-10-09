'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    // Server first: revokes the session and expires the auth cookies
    // (app/auth/signout/route.ts). Then clear this tab's client, and load the
    // sign-in page fresh rather than client-side, so nothing signed-in is
    // left in memory.
    try {
      await fetch('/auth/signout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Fall through: the local sign-out below still clears this browser.
    }
    await supabaseBrowser().auth.signOut({ scope: 'local' }).catch(() => {});
    window.location.assign('/login');
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className="rounded-md border border-purity-bean/20 px-3 py-1.5 text-xs text-purity-muted transition hover:border-purity-rust hover:text-purity-rust disabled:opacity-60 dark:border-purity-paper/20 dark:text-purity-mist"
      aria-label="Sign out"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
