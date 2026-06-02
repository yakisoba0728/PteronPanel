import { NextResponse } from 'next/server';
import type { Theme } from '@/lib/theme';

async function readTheme(request: Request): Promise<Theme> {
  try {
    const body = (await request.json()) as { theme?: Theme };
    return body.theme === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export async function POST(request: Request) {
  const theme = await readTheme(request);
  const response = NextResponse.json({ ok: true });

  response.cookies.set('theme', theme, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  return response;
}
