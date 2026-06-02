import { NextResponse } from 'next/server';
import { getServer } from '@/lib/ptero/client';
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
    const { id } = await params;
    const sid = await pluginServer(ctx.owner, id);
    const details = await getServer(sid);
    return NextResponse.json({ server: details.attributes });
  } catch (err) {
    return extError(err);
  }
}
