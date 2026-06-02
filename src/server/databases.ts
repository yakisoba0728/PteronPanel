'use server';

import type { Prisma, User } from '@prisma/client';
import { z, type ZodError, type ZodType } from 'zod';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerPermission, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError, friendlyMessage } from '@/lib/ptero/errors';
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

const noNul = (value: string) => !value.includes('\0');
const identifierSchema = z.string().length(8).refine(noNul, 'must not contain NUL');
const databaseNameSchema = z
  .string()
  .trim()
  .min(1, 'database is required')
  .refine(noNul, 'must not contain NUL');
const remoteSchema = z.string().refine(noNul, 'must not contain NUL');
const pathIdSchema = z
  .string()
  .min(1, 'database id is required')
  .regex(/^[A-Za-z0-9_-]+$/, 'must be a path-safe id');
const listInputSchema = z.object({ identifier: identifierSchema });
const createInputSchema = z.object({
  identifier: identifierSchema,
  database: databaseNameSchema,
  remote: remoteSchema,
});
const databaseIdInputSchema = z.object({
  identifier: identifierSchema,
  dbId: pathIdSchema,
});

async function guard(identifier: string, permission: string) {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  await requireServerPermission(scope(user), id, permission);
  return { user, id };
}

function toFail(err: unknown): Fail {
  if (err instanceof ServerAccessDeniedError) {
    return { ok: false, error: 'not_found' };
  }

  const detail = err instanceof PteroApiError ? friendlyMessage(err) : undefined;
  console.error('database action failed', err);
  return { ok: false, error: 'failed', detail };
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
    const input = validateInput(listInputSchema, { identifier });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier, 'database.read');
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
    const input = validateInput(createInputSchema, {
      identifier,
      database,
      remote,
    });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier, 'database.create');
    const created = await ptero.createDatabase(id, {
      database: input.database,
      remote: input.remote || '%',
    });
    await auditAction('database.create', {
      userId: user.id,
      target: id,
      metadata: { database: input.database },
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
    const input = validateInput(databaseIdInputSchema, { identifier, dbId });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier, 'database.update');
    const database = await ptero.rotateDatabasePassword(id, input.dbId);
    await auditAction('database.rotate', {
      userId: user.id,
      target: id,
      metadata: { dbId: input.dbId },
    });
    return { ok: true, database };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteDatabaseAction(
  identifier: string,
  dbId: string,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(databaseIdInputSchema, { identifier, dbId });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier, 'database.delete');
    await ptero.deleteDatabase(id, input.dbId);
    await auditAction('database.delete', {
      userId: user.id,
      target: id,
      metadata: { dbId: input.dbId },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
