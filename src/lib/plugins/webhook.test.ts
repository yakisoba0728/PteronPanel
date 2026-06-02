import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signWebhook } from './webhook';

describe('signWebhook', () => {
  it('produces sha256=HMAC(secret, timestamp.body)', () => {
    const body = JSON.stringify({ event: 'server.power' });
    const ts = '1700000000';
    const sig = signWebhook('secret', ts, body);
    const expected =
      'sha256=' +
      createHmac('sha256', 'secret').update(`${ts}.${body}`).digest('hex');
    expect(sig).toBe(expected);
  });
});
