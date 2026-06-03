import { createHmac } from 'node:crypto';
import { assertSafeWebhookUrl, safeFetch } from './url-safety';

export interface DeliverResult {
  ok: boolean;
  attempts: number;
  status?: number;
  error?: string;
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return (
    'sha256=' +
    createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  );
}

/** POST a signed webhook with bounded retries and exponential backoff. */
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: unknown,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<DeliverResult> {
  // Fast-fail before entering the retry loop if the URL is statically unsafe.
  try {
    await assertSafeWebhookUrl(url);
  } catch (err) {
    return { ok: false, attempts: 0, error: err instanceof Error ? err.message : 'unsafe_url' };
  }

  const body = JSON.stringify(payload);
  const max = opts.retries ?? 2;

  for (let attempt = 0; ; attempt += 1) {
    const ts = String(Math.floor(epochSeconds()));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000);

    try {
      // safeFetch re-resolves + re-validates + pins the validated IP at the
      // socket, closing the DNS-rebind window for this attempt. redirect:
      // 'manual' prevents following a 3xx to an unvalidated location.
      const res = await safeFetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'X-Pteron-Event': (payload as { event?: string }).event ?? '',
          'X-Pteron-Timestamp': ts,
          'X-Pteron-Signature': signWebhook(secret, ts, body),
        },
        body,
        signal: ac.signal,
      });
      clearTimeout(timer);

      if (res.ok) return { ok: true, attempts: attempt + 1, status: res.status };
      if (attempt >= max) {
        return { ok: false, attempts: attempt + 1, status: res.status };
      }
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= max) {
        return {
          ok: false,
          attempts: attempt + 1,
          error: err instanceof Error ? err.message : 'network',
        };
      }
    }

    await sleep(Math.min(4000, 300 * 2 ** attempt));
  }
}

function epochSeconds(): number {
  return Date.now() / 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
