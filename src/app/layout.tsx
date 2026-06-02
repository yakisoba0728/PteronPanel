import type { Metadata } from 'next';
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

  return (
    <html lang="ko" className={theme}>
      <body>{children}</body>
    </html>
  );
}
