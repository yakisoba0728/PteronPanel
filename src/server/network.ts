'use server';

import type { Prisma, User } from '@prisma/client';
import { z, type ZodError, type ZodType } from 'zod';
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

const noNul = (value: string) => !value.includes('\0');
const identifierSchema = z.string().length(8).refine(noNul, 'must not contain NUL');
const allocationIdSchema = z.number().int().positive();
const notesSchema = z.string().refine(noNul, 'must not contain NUL');
const listInputSchema = z.object({ identifier: identifierSchema });
const allocationInputSchema = z.object({
  identifier: identifierSchema,
  allocId: allocationIdSchema,
});
const noteInputSchema = allocationInputSchema.extend({ notes: notesSchema });

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

export async function listAllocationsAction(
  identifier: string,
): Promise<Ok<{ allocations: ServerAllocation[] }> | Fail> {
  try {
    const input = validateInput(listInputSchema, { identifier });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
    return { ok: true, allocations: await ptero.listAllocations(id) };
  } catch (err) {
    return toFail(err);
  }
}

export async function assignAllocationAction(
  identifier: string,
): Promise<Ok<{ allocation: ServerAllocation }> | Fail> {
  try {
    const input = validateInput(listInputSchema, { identifier });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
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
    const input = validateInput(noteInputSchema, { identifier, allocId, notes });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
    await ptero.setAllocationNote(id, input.allocId, input.notes);
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
    const input = validateInput(allocationInputSchema, { identifier, allocId });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
    await ptero.setPrimaryAllocation(id, input.allocId);
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
    const input = validateInput(allocationInputSchema, { identifier, allocId });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    const allocations = await ptero.listAllocations(id);
    const allocation = allocations.find((item) => item.id === input.allocId);
    if (allocation?.is_default) {
      return {
        ok: false,
        error: 'failed',
        detail: '기본 할당은 삭제할 수 없습니다.',
      };
    }
    await ptero.deleteAllocation(id, input.allocId);
    await auditAction('network.delete', {
      userId: user.id,
      target: id,
      metadata: { allocId: input.allocId },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
