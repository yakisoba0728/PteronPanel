import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateContextToken, verifyContextToken } from './context-token';

afterEach(() => vi.useRealTimers());

describe('context token', () => {
  it('round-trips pluginId + ownerId', () => {
    const t = generateContextToken('pl1', 'u1', 5 * 60 * 1000);
    expect(t).toMatch(/^ptxc_/);
    expect(verifyContextToken(t)).toEqual({ pluginId: 'pl1', ownerId: 'u1' });
  });

  it('rejects a tampered token', () => {
    const t = generateContextToken('pl1', 'u1', 60_000);
    expect(verifyContextToken(t.slice(0, -3) + 'zzz')).toBeNull();
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    const t = generateContextToken('pl1', 'u1', 1000);
    vi.advanceTimersByTime(2000);
    expect(verifyContextToken(t)).toBeNull();
  });
});
