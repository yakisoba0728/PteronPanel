import { describe, expect, it, vi, beforeEach } from 'vitest';
import { asIdentifier, asUuid, type AccessibleServer } from '@/lib/ptero/types';

const { resolveAccessibleServers } = vi.hoisted(() => ({
  resolveAccessibleServers: vi.fn(),
}));

vi.mock('./access', () => ({ resolveAccessibleServers }));

import {
  requireServerPermission,
  ServerPermissionDeniedError,
} from './guard';

const subuserServer: AccessibleServer = {
  identifier: asIdentifier('1a2b3c4d'),
  uuid: asUuid('1a2b3c4d-0000-4000-8000-000000000000'),
  name: 'Shared',
  accessKind: 'subuser',
  permissions: ['control.console'],
};

describe('requireServerPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAccessibleServers.mockResolvedValue([subuserServer]);
  });

  it('allows subusers with the required permission', async () => {
    await expect(
      requireServerPermission(
        { id: 'u', role: 'USER', pteroUserId: 7 },
        '1a2b3c4d',
        'control.console',
      ),
    ).resolves.toBe(subuserServer);
  });

  it('denies subusers missing the required permission', async () => {
    await expect(
      requireServerPermission(
        { id: 'u', role: 'USER', pteroUserId: 7 },
        '1a2b3c4d',
        'schedule.create',
      ),
    ).rejects.toBeInstanceOf(ServerPermissionDeniedError);
  });
});
