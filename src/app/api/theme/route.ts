import { NextResponse } from 'next/server';
import type { Theme } from '@/lib/theme';

export async function POST(request: Request) {
  const body = (await request.json()) as { theme?: Theme };
  const theme: Theme = body.theme === 'dark' ? 'dark' : 'light';
  const response = NextResponse.json({ ok: true });

  response.cookies.set('theme', theme, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  return response;
}
