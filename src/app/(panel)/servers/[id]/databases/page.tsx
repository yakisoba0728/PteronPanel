import { DatabasesView } from '@/features/databases/databases-view';

export default async function DatabasesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DatabasesView identifier={id} />;
}
