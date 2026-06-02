import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from '@/lib/config';

function sign(payloadB64: string): string {
  return createHmac('sha256', getConfig().SESSION_SECRET)
    .update(`ctx.${payloadB64}`)
    .digest('base64url');
}

/** Stateless short-lived token for iframe -> /api/ext. Format: ptxc_<payloadB64>.<sig> */
export function generateContextToken(pluginId: string, ownerId: string, ttlMs: number): string {
  const payload = { pluginId, ownerId, exp: Date.now() + ttlMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `ptxc_${payloadB64}.${sign(payloadB64)}`;
}

export function verifyContextToken(token: string): { pluginId: string; ownerId: string } | null {
  if (!token.startsWith('ptxc_')) return null;

  const [payloadB64, sig] = token.slice(5).split('.');
  if (!payloadB64 || !sig) return null;

  const expected = sign(payloadB64);
  const actualBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      pluginId: unknown;
      ownerId: unknown;
      exp: unknown;
    };
    if (
      typeof payload.pluginId !== 'string' ||
      typeof payload.ownerId !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp < Date.now()
    ) {
      return null;
    }

    return { pluginId: payload.pluginId, ownerId: payload.ownerId };
  } catch {
    return null;
  }
}
