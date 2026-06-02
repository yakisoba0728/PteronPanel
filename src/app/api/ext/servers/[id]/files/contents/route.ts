import { NextResponse } from 'next/server';
import { requireServerPermission } from '@/lib/authz/guard';
import { getFileContents } from '@/lib/ptero/client';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { extError } from '@/lib/plugins/respond';
import { pluginServer } from '@/lib/plugins/scope';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const file = new URL(req.url).searchParams.get('file');
    if (!file) return NextResponse.json({ error: 'missing_file' }, { status: 400 });

    const { id } = await params;
    const sid = await pluginServer(ctx.owner, id);
    await requireServerPermission(ctx.owner, sid, 'file.read');
    return NextResponse.json({ content: await getFileContents(sid, file) });
  } catch (err) {
    return extError(err);
  }
}
