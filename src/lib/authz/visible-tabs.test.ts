import { describe, it, expect } from 'vitest';
import { visibleTabs } from './visible-tabs';
import { serverTabs } from '@/registry/server-tabs';

describe('visibleTabs', () => {
  it('owners/admins see all tabs', () => {
    expect(visibleTabs('owner', []).length).toBe(serverTabs.length);
    expect(visibleTabs('admin', []).length).toBe(serverTabs.length);
  });
  it('subusers see ungated tabs + tabs whose permission they hold', () => {
    const tabs = visibleTabs('subuser', ['file.read']);
    const keys = tabs.map((t) => t.key);
    expect(keys).toContain('overview');
    expect(keys).toContain('console');
    expect(keys).toContain('files');
    expect(keys).not.toContain('databases');
    expect(keys).not.toContain('subusers');
  });
});
