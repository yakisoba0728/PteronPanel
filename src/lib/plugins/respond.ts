import { NextResponse } from 'next/server';
import { ServerAccessDeniedError } from '@/lib/authz/guard';
import { PteroApiError } from '@/lib/ptero/errors';
import type { PluginContext } from './auth';
import { consumePluginRateLimit } from './rate-limit';

export function extRateLimit(ctx: PluginContext): NextResponse | null {
  if (consumePluginRateLimit(ctx.pluginId)) return null;
  return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
}

export function extError(err: unknown): NextResponse {
  if (err instanceof ServerAccessDeniedError) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (err instanceof PteroApiError) {
    return NextResponse.json(
      { error: 'upstream', status: err.httpStatus },
      { status: err.httpStatus === 429 ? 429 : 502 },
    );
  }

  console.error('ext route failed', err);
  return NextResponse.json({ error: 'failed' }, { status: 500 });
}
