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

// Overhaul preview deployments are for admins only (decision 2026-10-03):
// signed-in non-admins see a notice instead of the page. Production is never
// affected (VERCEL_ENV is 'production' there), and sign-in still works.
function PreviewNotice() {
  return (
    <div className="hub-card max-w-xl">
      <h2>Preview for admins</h2>
      <p className="text-sm text-purity-muted dark:text-purity-mist">
        This is a preview of the new Research Hub, open to admins while it is reviewed. Everything you use today is on the
        live app.
      </p>
    </div>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const role = await getCurrentRole();
  const previewLocked = process.env.VERCEL_ENV === 'preview' && role !== null && role !== 'admin';
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
                <ManualUpdateButton />
                <SignOutButton />
              </div>
            </div>
          </header>
          <div className="sticky top-0 z-30 border-b border-purity-line bg-purity-card dark:border-purity-rule dark:bg-purity-shade">
            <div className="mx-auto max-w-[1380px] px-2 sm:px-4">
              <NavLinks role={role} />
            </div>
          </div>
          <main id="main" className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6 sm:py-8">{previewLocked ? <PreviewNotice /> : children}</main>
          {role && <RevaClippy />}
        </ToastProvider>
      </body>
    </html>
  );
}
