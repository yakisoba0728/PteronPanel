import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import { visibleTabs } from '@/lib/authz/visible-tabs';
import { ownerPluginTabs } from '@/lib/plugins/owner-tabs';
import { asIdentifier } from '@/lib/ptero/types';
import { serverTabs } from '@/registry/server-tabs';

interface RenderTab {
  key: string;
  label: string;
  href: string;
}

export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  let identifier;
  try {
    identifier = asIdentifier(id);
  } catch {
    notFound();
  }

  let name = id;
  let tabs: RenderTab[] = serverTabs.map((tab) => ({
    key: tab.key,
    label: tab.label,
    href: tab.href(id),
  }));
  try {
    const server = await requireServerAccess(
      { id: user.id, role: user.role, pteroUserId: user.pteroUserId },
      identifier,
    );
    name = server.name;
    tabs = [
      ...visibleTabs(server.accessKind ?? 'subuser', server.permissions ?? []).map((tab) => ({
        key: tab.key,
        label: tab.label,
        href: tab.href(id),
      })),
      ...(await ownerPluginTabs(user.id, id)),
    ];
  } catch (error) {
    if (error instanceof ServerAccessDeniedError) notFound();
    throw error;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">{name}</h1>
      <nav className="mt-3 mb-5 flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((tab) => {
          const className = 'px-3 py-2 text-sm hover:text-indigo-600';
          // Plugin tabs frame an external origin, and CSP frame-src is scoped
          // per document in server.ts. A soft client-side transition keeps the
          // previous document's frame-src ('none'), which would block the
          // iframe — so plugin tabs must load as a full navigation.
          return tab.key.startsWith('plugin:') ? (
            <a key={tab.key} href={tab.href} className={className}>
              {tab.label}
            </a>
          ) : (
            <Link key={tab.key} href={tab.href} className={className}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
