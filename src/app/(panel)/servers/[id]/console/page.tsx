import { ConsoleView } from '@/features/console/console-view';

export default async function ConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ConsoleView identifier={id} />;
}
