'use server';

import type { Prisma, User } from '@prisma/client';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
import { asIdentifier, type BackupEntry } from '@/lib/ptero/types';

function scope(user: User): ScopeUser {
  return {
    id: user.id,
    role: user.role,
    pteroUserId: user.pteroUserId,
  };
}

type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;

async function guard(identifier: string) {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  await requireServerAccess(scope(user), id);
  return { user, id };
}

function toFail(err: unknown): Fail {
  if (err instanceof ServerAccessDeniedError) {
    return { ok: false, error: 'not_found' };
  }

  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('backup action failed', err);
  return { ok: false, error: 'failed', detail };
}

async function auditAction(
  action: string,
  opts: { userId?: string; target?: string; metadata?: Prisma.InputJsonValue },
): Promise<void> {
  const { audit } = await import('@/lib/audit');
  await audit(action, opts);
}

export async function listBackupsAction(
  identifier: string,
): Promise<Ok<{ backups: BackupEntry[] }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, backups: await ptero.listBackups(id) };
  } catch (err) {
    return toFail(err);
  }
}

export async function createBackupAction(
  identifier: string,
  name?: string,
): Promise<Ok<{ backup: BackupEntry }> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    const backup = await ptero.createBackup(id, { name });
    await auditAction('backup.create', {
      userId: user.id,
      target: id,
      metadata: { name },
    });
    return { ok: true, backup };
  } catch (err) {
    return toFail(err);
  }
}

export async function backupDownloadUrlAction(
  identifier: string,
  uuid: string,
): Promise<Ok<{ url: string }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, url: await ptero.getBackupDownloadUrl(id, uuid) };
  } catch (err) {
    return toFail(err);
  }
}

export async function restoreBackupAction(
  identifier: string,
  uuid: string,
  truncate: boolean,
): Promise<Ok<{}> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.restoreBackup(id, uuid, truncate);
    await auditAction('backup.restore', {
      userId: user.id,
      target: id,
      metadata: { uuid, truncate },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function toggleBackupLockAction(
  identifier: string,
  uuid: string,
): Promise<Ok<{ backup: BackupEntry }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, backup: await ptero.toggleBackupLock(id, uuid) };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteBackupAction(
  identifier: string,
  uuid: string,
): Promise<Ok<{}> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.deleteBackup(id, uuid);
    await auditAction('backup.delete', {
      userId: user.id,
      target: id,
      metadata: { uuid },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
