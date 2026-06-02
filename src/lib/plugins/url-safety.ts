import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function localWebhooksAllowed(): boolean {
  return process.env.PTERON_ALLOW_LOCAL_WEBHOOKS === '1';
}

export function validateExternalHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (localWebhooksAllowed()) return url;
  if (isBlockedHost(url.hostname)) return null;
  return url;
}

export function validatePluginUiUrl(raw: string): URL | null {
  const url = validateExternalHttpUrl(raw);
  if (!url) return null;
  if (localWebhooksAllowed()) return url;
  return url.protocol === 'https:' ? url : null;
}

export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  const url = validateExternalHttpUrl(raw);
  if (!url) throw new Error('Unsafe webhook URL');
  if (localWebhooksAllowed()) return url;

  if (isIP(url.hostname)) return url;
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.some((address) => isBlockedHost(address.address))) {
    throw new Error('Unsafe webhook URL');
  }
  return url;
}

function isBlockedHost(host: string): boolean {
  const hostname = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isBlockedIpv4(hostname);
  if (ipVersion === 6) return isBlockedIpv6(hostname);
  return false;
}

function isBlockedIpv4(address: string): boolean {
  const [a, b, c] = address.split('.').map((part) => Number(part));
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIpv4(normalized.slice('::ffff:'.length));
  }

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}
