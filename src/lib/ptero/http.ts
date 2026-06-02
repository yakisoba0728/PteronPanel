import { getConfig } from '@/lib/config';
import { PteroApiError, parsePteroErrors } from './errors';

type Api = 'application' | 'client';

export interface FetchOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  retries?: number;
}

function buildUrl(
  panelUrl: string,
  api: Api,
  path: string,
  query?: FetchOpts['query']
): string {
  const url = new URL(`${panelUrl.replace(/\/$/, '')}/api/${api}${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }
  }

  return Math.min(2000, 250 * 2 ** attempt);
}

export async function pteroFetch<T = unknown>(
  api: Api,
  path: string,
  opts: FetchOpts = {}
): Promise<T> {
  const cfg = getConfig();
  const key = api === 'application' ? cfg.PTERO_APP_KEY : cfg.PTERO_CLIENT_KEY;
  const url = buildUrl(cfg.PANEL_URL, api, path, opts.query);
  const method = opts.method ?? 'GET';
  const maxRetries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429 && attempt < maxRetries) {
        await sleep(retryAfterMs(response, attempt));
        continue;
      }

      const text = await response.text();
      const json = text ? JSON.parse(text) : undefined;

      if (!response.ok) {
        throw new PteroApiError(
          response.status,
          parsePteroErrors(json),
          response.headers.get('x-request-id') ?? undefined
        );
      }

      return json as T;
    } catch (error) {
      clearTimeout(timer);

      if (error instanceof PteroApiError) {
        throw error;
      }

      const retryable = method === 'GET' && attempt < maxRetries;
      if (retryable) {
        await sleep(Math.min(2000, 250 * 2 ** attempt));
        continue;
      }

      throw error;
    }
  }
}
