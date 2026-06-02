'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function LocaleSwitcher() {
  const router = useRouter();

  async function toggle() {
    const current = document.cookie
      .split('; ')
      .find((row) => row.startsWith('locale='))
      ?.split('=')[1];
    const next = current === 'en' ? 'ko' : 'en';
    await fetch('/api/locale', { method: 'POST', body: JSON.stringify({ locale: next }) });
    router.refresh();
  }

  return (
    <Button variant="ghost" onClick={toggle} aria-label="언어 전환">
      KO/EN
    </Button>
  );
}
