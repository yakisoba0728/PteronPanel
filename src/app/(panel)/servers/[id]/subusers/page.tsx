import { SubusersView } from '@/features/subusers/subusers-view';

export default async function SubusersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SubusersView identifier={id} />;
}
