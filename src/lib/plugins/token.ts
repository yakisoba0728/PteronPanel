import { createHmac, randomBytes } from 'node:crypto';
import { getConfig } from '@/lib/config';

export function generatePluginToken(): string {
  return `ptex_${randomBytes(32).toString('base64url')}`;
}

export function hashPluginToken(token: string): string {
  return createHmac('sha256', getConfig().SESSION_SECRET).update(token).digest('hex');
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}
