import { NextResponse } from 'next/server';
import type { Locale } from '@/lib/i18n';

export async function POST(request: Request) {
  const body = (await request.json()) as { locale?: Locale };
  const locale: Locale = body.locale === 'en' ? 'en' : 'ko';
  const response = NextResponse.json({ ok: true });

  response.cookies.set('locale', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  return response;
}
