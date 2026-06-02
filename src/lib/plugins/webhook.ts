import { createHmac } from 'node:crypto';

export interface DeliverResult {
  ok: boolean;
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
  const body = JSON.stringify(payload);
  const max = opts.retries ?? 2;

  for (let attempt = 0; ; attempt += 1) {
    const ts = String(Math.floor(epochSeconds()));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000);

    try {
      const res = await fetch(url, {
        method: 'POST',
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

      if (res.ok) return { ok: true, status: res.status };
      if (attempt >= max) return { ok: false, status: res.status };
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= max) {
        return {
          ok: false,
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
