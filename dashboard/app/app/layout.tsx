import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';
import { ManualUpdateButton } from './_components/ManualUpdateButton';
import { NavLinks, type Role } from './_components/NavLinks';
import { ThemeScript } from './_components/ThemeScript';
import { ThemeToggle } from './_components/ThemeToggle';
import { ToastProvider } from './_components/Toast';
import { SignOutButton } from './_components/SignOutButton';
import { RevaClippy } from './_components/RevaClippy';

export const metadata: Metadata = {
  title: 'Purity Research Hub',
  description: 'Research, support, COA questions and claims for Purity Coffee.',
};

// Signed in and role are separate: a signed-in account with an unrecognized
// role still needs Sign out, but gets no nav.
async function getSession(): Promise<{ signedIn: boolean; role: Role }> {
  try {
    const supabase = supabaseServer(await cookies());
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { signedIn: false, role: null };
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', auth.user.id).single();
    const r = profile?.role;
    if (r === 'admin' || r === 'editor' || r === 'customer_service') return { signedIn: true, role: r };
    // Legacy aliases.
    if (r === 'researcher') return { signedIn: true, role: 'editor' };
    if (r === 'user') return { signedIn: true, role: 'customer_service' };
    return { signedIn: true, role: null };
  } catch {
    return { signedIn: false, role: null };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { signedIn, role } = await getSession();
  // Manual update is editor-only server side (api/update/manual), so only staff see it.
  const staff = role === 'admin' || role === 'editor';
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <ToastProvider>
          <a href="#main" className="skip-to-main">Skip to main content</a>
          <header className="hub-header">
            <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
              <Link href="/" className="flex min-w-0 items-center gap-3 text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/purity-logo.png" alt="Purity Coffee" className="h-10 w-auto opacity-95 brightness-0 invert" />
                <span className="min-w-0">
                  <span className="block text-xl font-bold leading-tight tracking-tight sm:text-2xl">Purity Research Hub</span>
                  <span className="hidden text-sm opacity-90 sm:block">Research, support, COA questions and claims in one place</span>
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-2 rounded-lg bg-white/95 px-2 py-1.5 dark:bg-purity-shade/95">
                <ThemeToggle />
                {staff && <ManualUpdateButton />}
                {signedIn && <SignOutButton />}
              </div>
            </div>
          </header>
          <div className="sticky top-0 z-30 border-b border-purity-line bg-purity-card dark:border-purity-rule dark:bg-purity-shade">
            <div className="mx-auto max-w-[1380px] px-2 sm:px-4">
              <NavLinks role={role} />
            </div>
          </div>
          <main id="main" className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
          {role && <RevaClippy />}
        </ToastProvider>
      </body>
    </html>
  );
}
