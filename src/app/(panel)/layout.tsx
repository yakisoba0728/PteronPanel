import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { ToastProvider } from '@/components/toast/toast-provider';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/current-user';
import { logoutAction } from '@/server/auth';

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <aside className="w-56 shrink-0 border-r border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-6 text-lg font-bold">Pteron</div>
          <nav className="space-y-1 text-sm">
            <Link
              href="/servers"
              className="block rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              서버
            </Link>
            {user.role === 'ADMIN' && (
              <Link
                href="/admin"
                className="block rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                관리자
              </Link>
            )}
            <Link
              href="/account"
              className="block rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              계정
            </Link>
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
            <span className="text-sm text-zinc-500">{user.username}</span>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <form action={logoutAction}>
                <Button variant="ghost" type="submit">
                  로그아웃
                </Button>
              </form>
            </div>
          </header>
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
