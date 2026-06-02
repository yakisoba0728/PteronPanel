import { FileBrowser } from '@/features/files/file-browser';

export default async function FilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FileBrowser identifier={id} />;
}
