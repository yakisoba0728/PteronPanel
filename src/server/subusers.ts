'use server';

import type { User } from '@prisma/client';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
import { asIdentifier, type Subuser } from '@/lib/ptero/types';

function scope(user: User): ScopeUser {
  return {
    id: user.id,
    role: user.role,
    pteroUserId: user.pteroUserId,
  };
}

type Fail = {
  ok: false;
  error: 'not_found' | 'failed' | 'validation';
  detail?: string;
};
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

  if (err instanceof z.ZodError) {
    return {
      ok: false,
      error: 'validation',
      detail: err.issues[0]?.message,
    };
  }

  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('subuser action failed', err);
  return { ok: false, error: 'failed', detail };
}

const emailSchema = z.string().email();
const permissionsSchema = z
  .array(z.string().regex(/^[a-z_]+\.[a-z_-]+$/))
  .min(1);

export async function listSubusersAction(
  identifier: string,
): Promise<Ok<{ subusers: Subuser[] }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, subusers: await ptero.listSubusers(id) };
  } catch (err) {
    return toFail(err);
  }
}

export async function getPermissionsAction(
  identifier: string,
): Promise<Ok<{ keys: string[] }> | Fail> {
  try {
    await guard(identifier);
    return { ok: true, keys: await ptero.listPermissionKeys() };
  } catch (err) {
    return toFail(err);
  }
}

export async function createSubuserAction(
  identifier: string,
  email: string,
  permissions: string[],
): Promise<Ok<{ subuser: Subuser }> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    const parsedEmail = emailSchema.parse(email);
    const parsedPermissions = permissionsSchema.parse(permissions);
    const subuser = await ptero.createSubuser(
      id,
      parsedEmail,
      parsedPermissions,
    );
    await audit('subuser.create', {
      userId: user.id,
      target: id,
      metadata: { email: parsedEmail },
    });
    return { ok: true, subuser };
  } catch (err) {
    return toFail(err);
  }
}

export async function updateSubuserAction(
  identifier: string,
  subuserUuid: string,
  permissions: string[],
): Promise<Ok | Fail> {
  try {
    const { user, id } = await guard(identifier);
    const parsedPermissions = permissionsSchema.parse(permissions);
    await ptero.updateSubuser(id, subuserUuid, parsedPermissions);
    await audit('subuser.update', {
      userId: user.id,
      target: id,
      metadata: { subuserUuid },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteSubuserAction(
  identifier: string,
  subuserUuid: string,
): Promise<Ok | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.deleteSubuser(id, subuserUuid);
    await audit('subuser.delete', {
      userId: user.id,
      target: id,
      metadata: { subuserUuid },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
