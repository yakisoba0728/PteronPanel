import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import { asIdentifier } from '@/lib/ptero/types';
import { serverTabs } from '@/registry/server-tabs';

export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  let name = id;
  try {
    const server = await requireServerAccess(
      { id: user.id, role: user.role, pteroUserId: user.pteroUserId },
      asIdentifier(id),
    );
    name = server.name;
  } catch (error) {
    if (error instanceof ServerAccessDeniedError) notFound();
    throw error;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">{name}</h1>
      <nav className="mt-3 mb-5 flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {serverTabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href(id)}
            className="px-3 py-2 text-sm hover:text-indigo-600"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
