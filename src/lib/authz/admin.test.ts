import { describe, expect, it } from 'vitest';
import { AdminRequiredError, assertAdmin } from './admin';

describe('assertAdmin', () => {
  it('passes for an ADMIN', () => {
    expect(() =>
      assertAdmin({ id: 'a', role: 'ADMIN', pteroUserId: null }),
    ).not.toThrow();
  });

  it('throws AdminRequiredError for a USER', () => {
    expect(() =>
      assertAdmin({ id: 'u', role: 'USER', pteroUserId: 1 }),
    ).toThrow(AdminRequiredError);
  });
});
