import { FileEditor } from '@/features/files/file-editor';

export default async function FileEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { id } = await params;
  const { path } = await searchParams;

  if (!path) {
    return <p className="text-sm text-red-600">경로가 필요합니다.</p>;
  }

  return <FileEditor identifier={id} path={path} />;
}
