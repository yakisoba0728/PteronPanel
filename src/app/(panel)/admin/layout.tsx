import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/current-user';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div>
      <nav className="mb-5 flex gap-2 border-b border-zinc-200 pb-2 text-sm dark:border-zinc-800">
        <Link href="/admin" className="px-3 py-1.5 hover:text-indigo-600">
          개요
        </Link>
        <Link
          href="/admin/users"
          className="px-3 py-1.5 hover:text-indigo-600"
        >
          유저
        </Link>
        <Link
          href="/admin/servers"
          className="px-3 py-1.5 hover:text-indigo-600"
        >
          서버
        </Link>
        <Link
          href="/admin/nodes"
          className="px-3 py-1.5 hover:text-indigo-600"
        >
          노드
        </Link>
        <Link
          href="/admin/locations"
          className="px-3 py-1.5 hover:text-indigo-600"
        >
          로케이션
        </Link>
      </nav>
      {children}
    </div>
  );
}
