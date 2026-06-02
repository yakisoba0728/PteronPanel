'use server';

import type { Prisma, User } from '@prisma/client';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
import { asIdentifier, type StartupVariable } from '@/lib/ptero/types';

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
  console.error('startup action failed', err);
  return { ok: false, error: 'failed', detail };
}

async function auditAction(
  action: string,
  opts: { userId?: string; target?: string; metadata?: Prisma.InputJsonValue },
): Promise<void> {
  const { audit } = await import('@/lib/audit');
  await audit(action, opts);
}

export async function getStartupAction(
  identifier: string,
): Promise<Ok<{ variables: StartupVariable[] }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, variables: await ptero.getStartupVariables(id) };
  } catch (err) {
    return toFail(err);
  }
}

export async function updateStartupVariableAction(
  identifier: string,
  key: string,
  value: string,
): Promise<Ok | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.updateStartupVariable(id, key, value);
    await auditAction('startup.update', {
      userId: user.id,
      target: id,
      metadata: { key },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
