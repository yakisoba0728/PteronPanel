import { ConsoleView } from '@/features/console/console-view';
import { getConsoleAccess } from '@/server/console';

export default async function ConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { accessKind, permissions } = await getConsoleAccess(id);

  return (
    <ConsoleView
      identifier={id}
      accessKind={accessKind}
      permissions={permissions}
    />
  );
}
