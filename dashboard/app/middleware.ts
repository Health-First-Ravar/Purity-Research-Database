import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/confirm', '/auth/update-password'];

// Overhaul preview deployments are for admins only (decision 2026-10-03).
// Production (VERCEL_ENV=production) and local dev are never gated.
const PREVIEW = process.env.VERCEL_ENV === 'preview';
const PREVIEW_NOTICE = '/preview-only';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/update/')) return NextResponse.next();
  if (pathname.startsWith('/api/auth/')) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) =>
          res.cookies.set({ name, value, ...options }),
        remove: (name: string, options: CookieOptions) =>
          res.cookies.set({ name, value: '', ...options }),
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (PREVIEW && pathname !== PREVIEW_NOTICE) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'preview_admins_only' }, { status: 403 });
      }
      const url = req.nextUrl.clone();
      url.pathname = PREVIEW_NOTICE;
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
