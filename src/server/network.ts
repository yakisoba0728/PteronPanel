'use server';

import type { Prisma, User } from '@prisma/client';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
import { asIdentifier, type ServerAllocation } from '@/lib/ptero/types';

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
  console.error('network action failed', err);
  return { ok: false, error: 'failed', detail };
}

async function auditAction(
  action: string,
  opts: { userId?: string; target?: string; metadata?: Prisma.InputJsonValue },
): Promise<void> {
  const { audit } = await import('@/lib/audit');
  await audit(action, opts);
}

export async function listAllocationsAction(
  identifier: string,
): Promise<Ok<{ allocations: ServerAllocation[] }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, allocations: await ptero.listAllocations(id) };
  } catch (err) {
    return toFail(err);
  }
}

export async function assignAllocationAction(
  identifier: string,
): Promise<Ok<{ allocation: ServerAllocation }> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    const allocation = await ptero.assignAllocation(id);
    await auditAction('network.assign', { userId: user.id, target: id });
    return { ok: true, allocation };
  } catch (err) {
    return toFail(err);
  }
}

export async function setAllocationNoteAction(
  identifier: string,
  allocId: number,
  notes: string,
): Promise<Ok | Fail> {
  try {
    const { id } = await guard(identifier);
    await ptero.setAllocationNote(id, allocId, notes);
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function setPrimaryAllocationAction(
  identifier: string,
  allocId: number,
): Promise<Ok | Fail> {
  try {
    const { id } = await guard(identifier);
    await ptero.setPrimaryAllocation(id, allocId);
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteAllocationAction(
  identifier: string,
  allocId: number,
): Promise<Ok | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.deleteAllocation(id, allocId);
    await auditAction('network.delete', {
      userId: user.id,
      target: id,
      metadata: { allocId },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
