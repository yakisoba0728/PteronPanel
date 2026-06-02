import { describe, expect, it } from 'vitest';
import { generatePluginToken, generateWebhookSecret, hashPluginToken } from './token';

describe('plugin token', () => {
  it('generates a ptex_-prefixed token and a stable hash', () => {
    const token = generatePluginToken();
    expect(token).toMatch(/^ptex_[A-Za-z0-9_-]{43}$/);
    expect(hashPluginToken(token)).toBe(hashPluginToken(token));
    expect(hashPluginToken(token)).not.toBe(token);
  });

  it('different tokens hash differently', () => {
    expect(hashPluginToken(generatePluginToken())).not.toBe(
      hashPluginToken(generatePluginToken()),
    );
  });

  it('webhook secret is random hex', () => {
    expect(generateWebhookSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
});
