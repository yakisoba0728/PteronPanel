'use server';

import type { Prisma, User } from '@prisma/client';
import { z, type ZodError, type ZodType } from 'zod';
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

type Fail = { ok: false; error: 'not_found' | 'failed' | 'locked'; detail?: string };
type Ok<T extends object = object> = { ok: true } & T;

const noNul = (value: string) => !value.includes('\0');
const identifierSchema = z.string().length(8).refine(noNul, 'must not contain NUL');
const backupUuidSchema = z.string().min(1).refine(noNul, 'must not contain NUL');
const backupNameSchema = z.string().min(1).refine(noNul, 'must not contain NUL');
const identifierInputSchema = z.object({ identifier: identifierSchema });
const createInputSchema = z.object({
  identifier: identifierSchema,
  name: backupNameSchema.optional(),
});
const uuidInputSchema = z.object({
  identifier: identifierSchema,
  uuid: backupUuidSchema,
});
const restoreInputSchema = uuidInputSchema.extend({ truncate: z.boolean() });

async function guard(identifier: string) {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  await requireServerAccess(scope(user), id);
  return { user, id };
}

function validationDetail(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function validateInput<T>(schema: ZodType<T>, value: unknown): T | Fail {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: 'failed', detail: validationDetail(parsed.error) };
  }
  return parsed.data;
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
    const input = validateInput(identifierInputSchema, { identifier });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
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
    const input = validateInput(createInputSchema, { identifier, name });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    const backup = await ptero.createBackup(id, { name: input.name });
    await auditAction('backup.create', {
      userId: user.id,
      target: id,
      metadata: { name: input.name },
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
    const input = validateInput(uuidInputSchema, { identifier, uuid });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
    return { ok: true, url: await ptero.getBackupDownloadUrl(id, input.uuid) };
  } catch (err) {
    return toFail(err);
  }
}

export async function restoreBackupAction(
  identifier: string,
  uuid: string,
  truncate: boolean,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(restoreInputSchema, { identifier, uuid, truncate });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    await ptero.restoreBackup(id, input.uuid, input.truncate);
    await auditAction('backup.restore', {
      userId: user.id,
      target: id,
      metadata: { uuid: input.uuid, truncate: input.truncate },
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
    const input = validateInput(uuidInputSchema, { identifier, uuid });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    const backup = await ptero.toggleBackupLock(id, input.uuid);
    await auditAction('backup.lock', {
      userId: user.id,
      target: id,
      metadata: { uuid: input.uuid, locked: backup.is_locked },
    });
    return { ok: true, backup };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteBackupAction(
  identifier: string,
  uuid: string,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(uuidInputSchema, { identifier, uuid });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    const backup = await ptero.getBackup(id, input.uuid);
    if (backup.is_locked) {
      return { ok: false, error: 'locked' };
    }
    await ptero.deleteBackup(id, input.uuid);
    await auditAction('backup.delete', {
      userId: user.id,
      target: id,
      metadata: { uuid: input.uuid },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
