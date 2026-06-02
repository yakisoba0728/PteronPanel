import { serverTabs, type ServerTab } from '@/registry/server-tabs';

export type AccessKind = 'owner' | 'admin' | 'subuser';

export function visibleTabs(accessKind: AccessKind, permissions: string[]): ServerTab[] {
  if (accessKind === 'owner' || accessKind === 'admin') {
    return serverTabs;
  }

  const granted = new Set(permissions);
  return serverTabs.filter((tab) => !tab.permission || granted.has(tab.permission));
}
