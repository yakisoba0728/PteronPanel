import { BackupsView } from '@/features/backups/backups-view';

export default async function BackupsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BackupsView identifier={id} />;
}
