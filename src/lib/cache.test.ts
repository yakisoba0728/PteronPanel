import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from './cache';

describe('TtlCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns a stored value before expiry', () => {
    const c = new TtlCache<string, number>(1000);
    c.set('a', 42);
    expect(c.get('a')).toBe(42);
  });

  it('expires values after the TTL', () => {
    const c = new TtlCache<string, number>(1000);
    c.set('a', 42);
    vi.advanceTimersByTime(1001);
    expect(c.get('a')).toBeUndefined();
  });

  it('supports delete and clear', () => {
    const c = new TtlCache<string, number>(1000);
    c.set('a', 1);
    c.set('b', 2);
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
    c.clear();
    expect(c.get('b')).toBeUndefined();
  });
});
