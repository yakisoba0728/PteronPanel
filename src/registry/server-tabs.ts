export interface ServerTab {
  key: string;
  label: string;
  href: (identifier: string) => string;
}

// Built-in tabs. Plugins (Phase 6) extend this via registerServerTab().
export const serverTabs: ServerTab[] = [
  { key: 'overview', label: '개요', href: (id) => `/servers/${id}` },
  { key: 'console', label: '콘솔', href: (id) => `/servers/${id}/console` },
  { key: 'files', label: '파일', href: (id) => `/servers/${id}/files` },
  { key: 'backups', label: '백업', href: (id) => `/servers/${id}/backups` },
  { key: 'databases', label: '데이터베이스', href: (id) => `/servers/${id}/databases` },
  { key: 'network', label: '네트워크', href: (id) => `/servers/${id}/network` },
  { key: 'startup', label: 'Startup', href: (id) => `/servers/${id}/startup` },
  { key: 'settings', label: '설정', href: (id) => `/servers/${id}/settings` },
  { key: 'schedules', label: '스케줄', href: (id) => `/servers/${id}/schedules` },
  { key: 'activity', label: '활동', href: (id) => `/servers/${id}/activity` },
];

export function registerServerTab(tab: ServerTab): void {
  if (!serverTabs.some((existing) => existing.key === tab.key)) {
    serverTabs.push(tab);
  }
}
