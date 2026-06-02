import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { requireServerPermission } from '@/lib/authz/guard';
import { writeFile } from '@/lib/ptero/client';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { extError, extRateLimit } from '@/lib/plugins/respond';
import { pluginServer } from '@/lib/plugins/scope';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = extRateLimit(ctx);
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const file = typeof body.file === 'string' ? body.file : '';
    const content = typeof body.content === 'string' ? body.content : '';
    if (!file) return NextResponse.json({ error: 'missing_file' }, { status: 400 });

    const { id } = await params;
    const sid = await pluginServer(ctx.owner, id);
    await requireServerPermission(ctx.owner, sid, 'file.update');
    await writeFile(sid, file, content);
    await audit('ext.file.write', {
      userId: ctx.owner.id,
      target: sid,
      metadata: { pluginId: ctx.pluginId, file },
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return extError(err);
  }
}
