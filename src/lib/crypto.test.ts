import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';

describe('crypto', () => {
  it('round-trips a secret', () => {
    const enc = encryptSecret('webhook-secret-123');
    expect(enc).not.toContain('webhook-secret-123');
    expect(decryptSecret(enc)).toBe('webhook-secret-123');
  });

  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('throws on tampered ciphertext', () => {
    const enc = encryptSecret('y');
    const tampered = enc.slice(0, -2) + (enc.endsWith('AA') ? 'BB' : 'AA');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
