import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db';
import { PluginFrame } from '@/features/plugins/plugin-frame';

export default async function PluginTabPage({
  params,
}: {
  params: Promise<{ id: string; pluginId: string }>;
}) {
  const { pluginId } = await params;
  const user = await requireUser();
  const plugin = await prisma.plugin.findFirst({
    where: { id: pluginId, ownerId: user.id, enabled: true, uiTabUrl: { not: null } },
  });
  if (!plugin?.uiTabUrl) notFound();

  return (
    <div className="space-y-2">
      <h2 className="font-medium">{plugin.uiTabLabel ?? plugin.name}</h2>
      <PluginFrame pluginId={plugin.id} src={plugin.uiTabUrl} />
    </div>
  );
}
