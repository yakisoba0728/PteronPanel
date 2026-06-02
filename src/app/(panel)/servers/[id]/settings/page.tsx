import { notFound } from 'next/navigation';
import { SettingsView } from '@/features/settings/settings-view';
import { ServerAccessDeniedError } from '@/lib/authz/guard';
import { getServerOverview } from '@/server/servers';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let attributes: Record<string, unknown>;
  try {
    ({ attributes } = await getServerOverview(id));
  } catch (error) {
    if (error instanceof ServerAccessDeniedError) notFound();
    throw error;
  }

  return (
    <SettingsView
      identifier={id}
      currentName={(attributes as { name?: string }).name ?? id}
    />
  );
}
