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

  it('evicts the oldest entry once capacity is exceeded', () => {
    const c = new TtlCache<string, number>(1000, 2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3); // exceeds maxEntries=2, evicts oldest ('a')
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  it('refreshes recency on get so the least-recently-used entry is evicted', () => {
    const c = new TtlCache<string, number>(1000, 2);
    c.set('a', 1);
    c.set('b', 2);
    // Touch 'a' so 'b' becomes the least-recently-used entry.
    expect(c.get('a')).toBe(1);
    c.set('c', 3); // evicts the LRU entry ('b'), not 'a'
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
  });
});
