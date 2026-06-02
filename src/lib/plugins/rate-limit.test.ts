import { describe, expect, it, beforeEach } from 'vitest';
import { consumePluginRateLimit, resetPluginRateLimits } from './rate-limit';

describe('plugin rate limit', () => {
  beforeEach(() => resetPluginRateLimits());

  it('allows requests up to the per-window limit', () => {
    expect(consumePluginRateLimit('pl1', 1000, 2)).toBe(true);
    expect(consumePluginRateLimit('pl1', 1001, 2)).toBe(true);
    expect(consumePluginRateLimit('pl1', 1002, 2)).toBe(false);
  });

  it('resets after one minute', () => {
    expect(consumePluginRateLimit('pl1', 1000, 1)).toBe(true);
    expect(consumePluginRateLimit('pl1', 1001, 1)).toBe(false);
    expect(consumePluginRateLimit('pl1', 61_000, 1)).toBe(true);
  });
});
