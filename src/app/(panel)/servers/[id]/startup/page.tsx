import { StartupView } from '@/features/startup/startup-view';

export default async function StartupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StartupView identifier={id} />;
}
