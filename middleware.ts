import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/constants';

const PUBLIC_PATHS = ['/login'];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === '/login' && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/servers';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
