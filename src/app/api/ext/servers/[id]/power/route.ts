import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { requireServerPermission } from '@/lib/authz/guard';
import { powerServer } from '@/lib/ptero/client';
import type { PowerSignal } from '@/lib/ptero/types';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { extError } from '@/lib/plugins/respond';
import { pluginServer } from '@/lib/plugins/scope';

const SIGNALS = new Set(['start', 'stop', 'restart', 'kill']);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const sid = await pluginServer(ctx.owner, id);
    const body = await req.json().catch(() => ({}));
    const signal = String(body.signal ?? '');
    if (!SIGNALS.has(signal)) {
      return NextResponse.json({ error: 'invalid_signal' }, { status: 400 });
    }

    const permission = signal === 'kill' ? 'control.stop' : `control.${signal}`;
    await requireServerPermission(ctx.owner, sid, permission);
    await powerServer(sid, signal as PowerSignal);
    await audit('ext.power', {
      userId: ctx.owner.id,
      target: sid,
      metadata: { pluginId: ctx.pluginId, signal },
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return extError(err);
  }
}
