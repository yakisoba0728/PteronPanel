import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { requireServerPermission } from '@/lib/authz/guard';
import { createBackup, listBackups } from '@/lib/ptero/client';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { extError, extRateLimit } from '@/lib/plugins/respond';
import { pluginServer } from '@/lib/plugins/scope';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = extRateLimit(ctx);
  if (limited) return limited;

  try {
    const { id } = await params;
    const sid = await pluginServer(ctx.owner, id);
    await requireServerPermission(ctx.owner, sid, 'backup.read');
    return NextResponse.json({ backups: await listBackups(sid) });
  } catch (err) {
    return extError(err);
  }
}

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
    const name = typeof body.name === 'string' && body.name.trim() ? body.name : undefined;
    const { id } = await params;
    const sid = await pluginServer(ctx.owner, id);
    await requireServerPermission(ctx.owner, sid, 'backup.create');
    const backup = await createBackup(sid, { name });
    await audit('ext.backup.create', {
      userId: ctx.owner.id,
      target: sid,
      metadata: { pluginId: ctx.pluginId, name },
    });

    return NextResponse.json({ backup }, { status: 201 });
  } catch (err) {
    return extError(err);
  }
}
