import { describe, it, expect } from 'vitest';
import { isInboundAllowed } from './frame-policy';

const owner = { accessKind: 'owner' as const, permissions: [] as string[] };
const sub = (perms: string[]) => ({ accessKind: 'subuser' as const, permissions: perms });

describe('isInboundAllowed', () => {
  it('owners/admins may send anything', () => {
    expect(isInboundAllowed(owner, { event: 'set state', args: ['kill'] })).toBe(true);
    expect(isInboundAllowed({ accessKind: 'admin', permissions: [] }, { event: 'send command', args: ['op me'] })).toBe(true);
  });
  it('subuser send command requires control.console', () => {
    expect(isInboundAllowed(sub(['control.console']), { event: 'send command', args: ['say hi'] })).toBe(true);
    expect(isInboundAllowed(sub([]), { event: 'send command', args: ['say hi'] })).toBe(false);
  });
  it('subuser set state requires the matching control.* permission', () => {
    expect(isInboundAllowed(sub(['control.start']), { event: 'set state', args: ['start'] })).toBe(true);
    expect(isInboundAllowed(sub(['control.start']), { event: 'set state', args: ['stop'] })).toBe(false);
    expect(isInboundAllowed(sub(['control.stop']), { event: 'set state', args: ['kill'] })).toBe(true);
  });
  it('always allows auth and read-only requests', () => {
    expect(isInboundAllowed(sub([]), { event: 'auth', args: ['x'] })).toBe(true);
    expect(isInboundAllowed(sub([]), { event: 'send logs', args: [] })).toBe(true);
    expect(isInboundAllowed(sub([]), { event: 'send stats', args: [] })).toBe(true);
  });
});
