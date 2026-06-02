import { NextResponse } from 'next/server';
import type { Locale } from '@/lib/i18n';

async function readLocale(request: Request): Promise<Locale> {
  try {
    const body = (await request.json()) as { locale?: Locale };
    return body.locale === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
}

export async function POST(request: Request) {
  const locale = await readLocale(request);
  const response = NextResponse.json({ ok: true });

  response.cookies.set('locale', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  return response;
}
