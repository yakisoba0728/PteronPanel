import type { Metadata } from 'next';
import { getLocale } from '@/lib/i18n';
import { getTheme } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pteron Panel',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await getTheme();
  const locale = await getLocale();

  return (
    <html lang={locale} className={theme === 'dark' ? 'dark' : ''}>
      <body>{children}</body>
    </html>
  );
}
