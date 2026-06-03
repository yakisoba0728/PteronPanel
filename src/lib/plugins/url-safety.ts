import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

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

interface ResolvedTarget {
  url: URL;
  /** Validated IPs to pin the connection to. Empty for literal-IP hosts. */
  pinned: { address: string; family: 4 | 6 }[];
}

/**
 * Validate a webhook URL: enforce scheme, reject literal blocked IPs, and for
 * hostnames resolve DNS once and require EVERY resolved address to pass the
 * blocklist. Returns the validated addresses so the caller can pin the
 * connection (closing the DNS-rebind window). Throws on any unsafe target.
 */
async function resolveSafeWebhookTarget(raw: string): Promise<ResolvedTarget> {
  const url = validateExternalHttpUrl(raw);
  if (!url) throw new Error('Unsafe webhook URL');
  if (localWebhooksAllowed()) return { url, pinned: [] };

  // Literal-IP hosts were already checked by validateExternalHttpUrl above, and
  // there is no name to rebind, so no pinning is required.
  if (isIP(url.hostname)) return { url, pinned: [] };

  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0) throw new Error('Unsafe webhook URL');
  if (addresses.some((address) => isBlockedHost(address.address))) {
    throw new Error('Unsafe webhook URL');
  }
  return {
    url,
    pinned: addresses.map((a) => ({
      address: a.address,
      family: a.family === 6 ? 6 : 4,
    })),
  };
}

export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  return (await resolveSafeWebhookTarget(raw)).url;
}

/**
 * Fetch a webhook URL with the validated IP pinned at connection time.
 *
 * `assertSafeWebhookUrl`/validateExternalHttpUrl validate the hostname, but a
 * plain `fetch(url)` re-resolves DNS — opening a rebind window where the name
 * can point at a freshly-validated public IP and then flip to loopback/private
 * before the socket connects. To close that window we resolve + validate ONCE
 * and pin the connection to the validated IP via an undici Agent whose
 * `connect.lookup` short-circuits resolution, while keeping the original
 * hostname for TLS SNI and the Host header.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const target = await resolveSafeWebhookTarget(url);

  // Literal IP or local-dev escape hatch: nothing to pin, just fetch.
  if (target.pinned.length === 0) {
    return fetch(target.url, init);
  }

  const pinned = target.pinned;
  const dispatcher = new Agent({
    connect: {
      // undici calls this in place of dns.lookup; return only the validated
      // addresses so the socket can never connect to a rebound IP.
      lookup: (
        _hostname: string,
        _options: unknown,
        callback: (
          err: NodeJS.ErrnoException | null,
          addresses: { address: string; family: number }[],
        ) => void,
      ) => {
        callback(null, pinned);
      },
    },
  });

  try {
    // Cast: RequestInit does not declare undici's `dispatcher`, but the global
    // fetch (undici under the hood) honors it.
    return await fetch(target.url, {
      ...init,
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
  } finally {
    await dispatcher.close().catch(() => {});
  }
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
  const bytes = expandIpv6(address);
  if (!bytes) return false;

  // Unspecified ::
  if (bytes.every((b) => b === 0)) return true;
  // Loopback ::1
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true;
  // Link-local fe80::/10
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  // Unique-local fc00::/7
  if ((bytes[0] & 0xfe) === 0xfc) return true;

  // Embedded-IPv4 prefixes — extract the last 4 bytes and apply the IPv4 blocklist.
  const high96Zero = bytes.slice(0, 12).every((b) => b === 0);
  const isV4Mapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff; // ::ffff:0:0/96
  const isNat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0); // 64:ff9b::/96
  // IPv4-compatible ::/96 (deprecated) — high 96 bits zero with non-zero low 32 bits.
  const low32 = bytes.slice(12);
  const isV4Compat = high96Zero && low32.some((b) => b !== 0);

  if (isV4Mapped || isNat64 || isV4Compat) {
    const embedded = `${low32[0]}.${low32[1]}.${low32[2]}.${low32[3]}`;
    return isBlockedIpv4(embedded);
  }

  return false;
}

/**
 * Expand an IPv6 literal (with optional `::` and trailing embedded IPv4) into
 * its 16 bytes. Returns null if the input is not a parseable IPv6 address.
 */
function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase().trim();
  if (text.length === 0) return null;
  // Strip a zone id (e.g. fe80::1%eth0) — irrelevant to the address itself.
  const zoneIdx = text.indexOf('%');
  if (zoneIdx !== -1) text = text.slice(0, zoneIdx);

  // A trailing dotted-decimal IPv4 tail (e.g. ::ffff:127.0.0.1) occupies the
  // final two hextets. Convert it up front so the rest is uniform hextets.
  let tailBytes: number[] | null = null;
  const lastColon = text.lastIndexOf(':');
  const tail = lastColon === -1 ? text : text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (lastColon === -1) return null; // a bare IPv4 is not an IPv6 literal
    const parts = tail.split('.');
    if (parts.length !== 4) return null;
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part)) return null;
      const n = Number(part);
      if (n > 255) return null;
      tailBytes ??= [];
      tailBytes.push(n);
    }
    // Replace the IPv4 tail with two zero hextets as placeholders; we append
    // the real bytes afterwards.
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toHextets = (segment: string): number[] | null => {
    if (segment === '') return [];
    const out: number[] = [];
    for (const part of segment.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  let hextets: number[];
  if (halves.length === 2) {
    const head = toHextets(halves[0]);
    const back = toHextets(halves[1]);
    if (head === null || back === null) return null;
    const fill = 8 - head.length - back.length;
    if (fill < 0) return null;
    hextets = [...head, ...new Array<number>(fill).fill(0), ...back];
  } else {
    const flat = toHextets(text);
    if (flat === null || flat.length !== 8) return null;
    hextets = flat;
  }
  if (hextets.length !== 8) return null;

  const bytes: number[] = [];
  for (const hextet of hextets) {
    bytes.push((hextet >> 8) & 0xff, hextet & 0xff);
  }
  if (tailBytes) {
    // Overwrite the last two hextets (4 bytes) with the embedded IPv4 octets.
    bytes[12] = tailBytes[0];
    bytes[13] = tailBytes[1];
    bytes[14] = tailBytes[2];
    bytes[15] = tailBytes[3];
  }

  return bytes.length === 16 ? bytes : null;
}
