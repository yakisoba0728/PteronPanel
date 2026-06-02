import { NetworkView } from '@/features/network/network-view';

export default async function NetworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NetworkView identifier={id} />;
}
