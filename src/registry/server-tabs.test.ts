import { describe, expect, it } from 'vitest';
import { registerServerTab, serverTabs } from './server-tabs';

describe('server tab registry', () => {
  it('ships built-in server tabs', () => {
    const keys = serverTabs.map((tab) => tab.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'overview',
        'console',
        'files',
        'backups',
        'databases',
        'network',
        'startup',
        'settings',
        'schedules',
        'activity',
      ]),
    );
  });

  it('builds hrefs from an identifier', () => {
    const overview = serverTabs.find((tab) => tab.key === 'overview')!;
    expect(overview.href('1a2b3c4d')).toBe('/servers/1a2b3c4d');
  });

  it('registerServerTab appends and dedupes by key', () => {
    const before = serverTabs.length;
    registerServerTab({ key: 'plugin-x', label: 'X', href: (id) => `/servers/${id}/x` });
    registerServerTab({ key: 'plugin-x', label: 'X dup', href: (id) => `/servers/${id}/x` });
    expect(serverTabs.length).toBe(before + 1);
  });
});
