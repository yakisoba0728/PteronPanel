import { ActivityView } from '@/features/activity/activity-view';

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ActivityView identifier={id} />;
}
