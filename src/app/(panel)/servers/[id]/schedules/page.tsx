import { SchedulesView } from '@/features/schedules/schedules-view';

export default async function SchedulesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SchedulesView identifier={id} />;
}
