'use server';

import type { Prisma, User } from '@prisma/client';
import { z, type ZodError, type ZodType } from 'zod';
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

const noNul = (value: string) => !value.includes('\0');
const identifierSchema = z.string().length(8).refine(noNul, 'must not contain NUL');
const variableKeySchema = z
  .string()
  .min(1, 'variable key is required')
  .regex(/^[A-Za-z0-9_]+$/, 'must be an environment variable key');
const variableValueSchema = z.string().refine(noNul, 'must not contain NUL');
const listInputSchema = z.object({ identifier: identifierSchema });
const updateInputSchema = z.object({
  identifier: identifierSchema,
  key: variableKeySchema,
  value: variableValueSchema,
});

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

export async function getStartupAction(
  identifier: string,
): Promise<Ok<{ variables: StartupVariable[] }> | Fail> {
  try {
    const input = validateInput(listInputSchema, { identifier });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
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
    const input = validateInput(updateInputSchema, { identifier, key, value });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier);
    await ptero.updateStartupVariable(id, input.key, input.value);
    await auditAction('startup.update', {
      userId: user.id,
      target: id,
      metadata: { key: input.key },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
