'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const router = useRouter();

  async function toggle() {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    await fetch('/api/theme', { method: 'POST', body: JSON.stringify({ theme: next }) });
    router.refresh();
  }

  return (
    <Button variant="ghost" onClick={toggle} aria-label="테마 전환">
      🌓
    </Button>
  );
}
