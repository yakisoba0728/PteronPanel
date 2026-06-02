import { cookies } from 'next/headers';
import { dictionaries } from './dictionaries';

export type Locale = keyof typeof dictionaries;

export function translate(locale: Locale, key: string): string {
  return dictionaries[locale][key as keyof (typeof dictionaries)[Locale]] ?? key;
}

export async function getLocale(): Promise<Locale> {
  return (await cookies()).get('locale')?.value === 'en' ? 'en' : 'ko';
}
