'use server';

import type { Prisma, User } from '@prisma/client';
import { z, type ZodError, type ZodType } from 'zod';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerPermission, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError, friendlyMessage } from '@/lib/ptero/errors';
import { asIdentifier } from '@/lib/ptero/types';

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
const serverNameSchema = z
  .string()
  .trim()
  .min(1, 'server name is required')
  .refine(noNul, 'must not contain NUL');
const descriptionSchema = z
  .string()
  .optional()
  .refine((value) => value === undefined || noNul(value), 'must not contain NUL');
const dockerImageSchema = z
  .string()
  .trim()
  .min(1, 'docker image is required')
  .refine(noNul, 'must not contain NUL');
const identifierInputSchema = z.object({ identifier: identifierSchema });
const renameInputSchema = z.object({
  identifier: identifierSchema,
  name: serverNameSchema,
  description: descriptionSchema,
});
const dockerImageInputSchema = z.object({
  identifier: identifierSchema,
  dockerImage: dockerImageSchema,
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
  console.error('settings action failed', err);
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

export async function renameServerAction(
  identifier: string,
  name: string,
  description?: string,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(renameInputSchema, {
      identifier,
      name,
      description,
    });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier, 'settings.rename');
    await ptero.renameServer(id, input.name, input.description);
    await auditAction('settings.rename', {
      userId: user.id,
      target: id,
      metadata: { name: input.name },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function reinstallServerAction(
  identifier: string,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(identifierInputSchema, { identifier });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier, 'settings.reinstall');
    await ptero.reinstallServer(id);
    await auditAction('settings.reinstall', {
      userId: user.id,
      target: id,
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function setDockerImageAction(
  identifier: string,
  dockerImage: string,
): Promise<Ok | Fail> {
  try {
    const input = validateInput(dockerImageInputSchema, {
      identifier,
      dockerImage,
    });
    if ('ok' in input) return input;
    const { user, id } = await guard(input.identifier, 'startup.docker-image');
    await ptero.setDockerImage(id, input.dockerImage);
    await auditAction('settings.docker_image', {
      userId: user.id,
      target: id,
      metadata: { dockerImage: input.dockerImage },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
