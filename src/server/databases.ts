'use server';

import type { Prisma, User } from '@prisma/client';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
import { asIdentifier, type ServerDatabase } from '@/lib/ptero/types';

function scope(user: User): ScopeUser {
  return {
    id: user.id,
    role: user.role,
    pteroUserId: user.pteroUserId,
  };
}

type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T extends object = object> = { ok: true } & T;

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
  console.error('database action failed', err);
  return { ok: false, error: 'failed', detail };
}

async function auditAction(
  action: string,
  opts: { userId?: string; target?: string; metadata?: Prisma.InputJsonValue },
): Promise<void> {
  const { audit } = await import('@/lib/audit');
  await audit(action, opts);
}

export async function listDatabasesAction(
  identifier: string,
): Promise<Ok<{ databases: ServerDatabase[] }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, databases: await ptero.listDatabases(id) };
  } catch (err) {
    return toFail(err);
  }
}

export async function createDatabaseAction(
  identifier: string,
  database: string,
  remote: string,
): Promise<Ok<{ database: ServerDatabase }> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    const created = await ptero.createDatabase(id, {
      database,
      remote: remote || '%',
    });
    await auditAction('database.create', {
      userId: user.id,
      target: id,
      metadata: { database },
    });
    return { ok: true, database: created };
  } catch (err) {
    return toFail(err);
  }
}

export async function rotateDatabasePasswordAction(
  identifier: string,
  dbId: string,
): Promise<Ok<{ database: ServerDatabase }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return {
      ok: true,
      database: await ptero.rotateDatabasePassword(id, dbId),
    };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteDatabaseAction(
  identifier: string,
  dbId: string,
): Promise<Ok | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.deleteDatabase(id, dbId);
    await auditAction('database.delete', {
      userId: user.id,
      target: id,
      metadata: { dbId },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
