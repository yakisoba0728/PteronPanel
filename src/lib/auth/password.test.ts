import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes and verifies the correct password', async () => {
    const hash = await hashPassword('s3cret-pw');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 's3cret-pw')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-pw');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
