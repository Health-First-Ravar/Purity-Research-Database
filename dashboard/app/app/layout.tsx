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
  title: 'Purity Dashboard',
  description: 'Research, COA reports, and customer-service chat for Purity Coffee.',
};

async function getCurrentRole(): Promise<Role> {
  try {
    const supabase = supabaseServer(await cookies());
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', auth.user.id).single();
    const r = profile?.role;
    if (r === 'admin' || r === 'editor' || r === 'customer_service') return r;
    // Legacy aliases.
    if (r === 'researcher') return 'editor';
    if (r === 'user') return 'customer_service';
    return null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const role = await getCurrentRole();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <ToastProvider>
          <a href="#main" className="skip-to-main">Skip to main content</a>
          <header className="sticky top-0 z-30 border-b border-purity-bean/10 bg-purity-cream/95 backdrop-blur dark:border-purity-paper/10 dark:bg-purity-ink/95">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-4 sm:gap-8">
                <Link href="/chat" className="shrink-0 font-serif text-lg tracking-tight">
                  Purity <span className="text-purity-green dark:text-purity-aqua">/</span> Dashboard
                </Link>
                <NavLinks role={role} />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ThemeToggle />
                <ManualUpdateButton />
                <SignOutButton />
              </div>
            </div>
          </header>
          <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
          {role && <RevaClippy />}
        </ToastProvider>
      </body>
    </html>
  );
}
