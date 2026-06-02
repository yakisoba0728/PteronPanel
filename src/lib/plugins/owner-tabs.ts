import { prisma } from '@/lib/db';

export interface PluginTab {
  key: string;
  label: string;
  href: string;
}

/** Tabs for the viewer's own uiTabUrl plugins, scoped to a server view. */
export async function ownerPluginTabs(ownerId: string, identifier: string): Promise<PluginTab[]> {
  const plugins = await prisma.plugin.findMany({
    where: { ownerId, enabled: true, uiTabUrl: { not: null } },
    orderBy: { createdAt: 'asc' },
  });

  return plugins
    .filter((plugin) => plugin.uiTabUrl)
    .map((plugin) => ({
      key: `plugin:${plugin.id}`,
      label: plugin.uiTabLabel ?? plugin.name,
      href: `/servers/${identifier}/plugin/${plugin.id}`,
    }));
}
