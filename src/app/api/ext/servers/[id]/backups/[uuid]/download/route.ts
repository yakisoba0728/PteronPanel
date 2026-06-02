import { NextResponse } from 'next/server';
import { requireServerPermission } from '@/lib/authz/guard';
import { getBackupDownloadUrl } from '@/lib/ptero/client';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { extError } from '@/lib/plugins/respond';
import { pluginServer } from '@/lib/plugins/scope';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; uuid: string }> },
) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { id, uuid } = await params;
    const sid = await pluginServer(ctx.owner, id);
    await requireServerPermission(ctx.owner, sid, 'backup.download');
    return NextResponse.json({ url: await getBackupDownloadUrl(sid, uuid) });
  } catch (err) {
    return extError(err);
  }
}
