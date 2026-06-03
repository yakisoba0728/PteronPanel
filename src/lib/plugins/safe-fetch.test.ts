import { Agent } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}));

import { safeFetch } from './url-safety';

const realFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.PTERON_ALLOW_LOCAL_WEBHOOKS;
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  lookupMock.mockReset();
});

describe('safeFetch DNS-rebind pinning', () => {
  beforeEach(() => {
    delete process.env.PTERON_ALLOW_LOCAL_WEBHOOKS;
  });

  it('rejects when the hostname resolves to a private/loopback IP', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(safeFetch('https://rebind.example.com/hook')).rejects.toThrow(
      /unsafe/i,
    );
    // Must never reach the network when validation fails.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects when ANY of several resolved IPs is private (multi-A rebind)', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(safeFetch('https://mixed.example.com/hook')).rejects.toThrow(
      /unsafe/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('pins the validated public IP via a dispatcher and keeps the original URL', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await safeFetch('https://public.example.com/hook', {
      method: 'POST',
    });
    expect(res.status).toBe(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    // Original hostname preserved for TLS SNI / Host header.
    expect(String(calledUrl)).toBe('https://public.example.com/hook');
    // A pinned dispatcher (undici Agent) must be supplied to short-circuit DNS.
    expect(init).toMatchObject({ method: 'POST' });
    expect(init.dispatcher).toBeInstanceOf(Agent);
  });

  it('does not pin (no dispatcher) for a literal-IP host, just validates', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await safeFetch('https://93.184.216.34/hook');
    expect(lookupMock).not.toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.dispatcher).toBeUndefined();
  });

  it('blocks a literal private-IP host before fetching', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(safeFetch('https://10.0.0.5/hook')).rejects.toThrow(/unsafe/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
