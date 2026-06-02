'use server';

import type { User } from '@prisma/client';
import { z, type ZodError, type ZodType } from 'zod';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
import { asIdentifier, type ActivityEntry } from '@/lib/ptero/types';

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
const listInputSchema = z.object({ identifier: identifierSchema });

async function guard(identifier: string) {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  await requireServerAccess(scope(user), id);
  return { id };
}

function toFail(err: unknown): Fail {
  if (err instanceof ServerAccessDeniedError) {
    return { ok: false, error: 'not_found' };
  }

  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('activity action failed', err);
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

export async function listActivityAction(
  identifier: string,
): Promise<Ok<{ entries: ActivityEntry[] }> | Fail> {
  try {
    const input = validateInput(listInputSchema, { identifier });
    if ('ok' in input) return input;
    const { id } = await guard(input.identifier);
    return { ok: true, entries: await ptero.listActivity(id) };
  } catch (err) {
    return toFail(err);
  }
}
