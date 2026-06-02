'use server';

import { z } from 'zod';
import { audit } from '@/lib/audit';
import { requireUser } from '@/lib/auth/current-user';
import { hashPassword } from '@/lib/auth/password';
import { assertAdmin, AdminRequiredError } from '@/lib/authz/admin';
import { prisma } from '@/lib/db';
import { PteroApiError } from '@/lib/ptero/errors';
import {
  createUser as createPteroUser,
  deleteUser as deletePteroUser,
  findUserByEmail,
} from '@/lib/ptero/application';

type Fail = {
  ok: false;
  error: 'forbidden' | 'failed' | 'validation';
  detail?: string;
};
type Ok<T> = { ok: true } & T;

async function admin() {
  const user = await requireUser();
  assertAdmin(user);
  return user;
}

function fail(err: unknown): Fail {
  if (err instanceof AdminRequiredError) {
    return { ok: false, error: 'forbidden' };
  }
  if (err instanceof z.ZodError) {
    return {
      ok: false,
      error: 'validation',
      detail: err.issues[0]?.message,
    };
  }

  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('admin user action failed', err);
  return { ok: false, error: 'failed', detail };
}

export interface PteronUserRow {
  id: string;
  email: string;
  username: string;
  role: 'ADMIN' | 'USER';
  isActive: boolean;
  pteroUserId: number | null;
}

export async function listPteronUsersAction(): Promise<
  Ok<{ users: PteronUserRow[] }> | Fail
> {
  try {
    await admin();
    const rows = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return {
      ok: true,
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        username: row.username,
        role: row.role,
        isActive: row.isActive,
        pteroUserId: row.pteroUserId,
      })),
    };
  } catch (err) {
    return fail(err);
  }
}

const CreateSchema = z.object({
  email: z.string().email(),
  username: z.string().min(1).max(191),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'USER']),
  createPterodactyl: z.boolean().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export async function createPteronUserAction(
  input: z.infer<typeof CreateSchema>,
): Promise<Ok<{ id: string }> | Fail> {
  try {
    const me = await admin();
    const data = CreateSchema.parse(input);
    let mapping = await findUserByEmail(data.email);

    if (!mapping && data.createPterodactyl) {
      const created = await createPteroUser({
        email: data.email,
        username: data.username,
        first_name: data.firstName ?? data.username,
        last_name: data.lastName ?? '-',
        password: data.password,
      });
      mapping = { id: created.id, uuid: created.uuid };
    }

    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        username: data.username,
        passwordHash: await hashPassword(data.password),
        role: data.role,
        pteroUserId: mapping?.id,
        pteroUuid: mapping?.uuid,
      },
    });

    await audit('admin.user.create', {
      userId: me.id,
      target: user.id,
      metadata: { role: data.role, mapped: Boolean(mapping) },
    });

    return { ok: true, id: user.id };
  } catch (err) {
    return fail(err);
  }
}

const UpdateSchema = z.object({
  id: z.string(),
  role: z.enum(['ADMIN', 'USER']).optional(),
  isActive: z.boolean().optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
});

export async function updatePteronUserAction(
  input: z.infer<typeof UpdateSchema>,
): Promise<Ok<Record<string, never>> | Fail> {
  try {
    const me = await admin();
    const data = UpdateSchema.parse(input);
    const patch: {
      role?: 'ADMIN' | 'USER';
      isActive?: boolean;
      email?: string;
      passwordHash?: string;
      pteroUserId?: number | null;
      pteroUuid?: string | null;
    } = {};

    if (data.role) patch.role = data.role;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.email) {
      patch.email = data.email.toLowerCase();
      const mapping = await findUserByEmail(data.email);
      patch.pteroUserId = mapping?.id ?? null;
      patch.pteroUuid = mapping?.uuid ?? null;
    }
    if (data.password) {
      patch.passwordHash = await hashPassword(data.password);
    }

    await prisma.user.update({ where: { id: data.id }, data: patch });
    await audit('admin.user.update', {
      userId: me.id,
      target: data.id,
      metadata: { fields: Object.keys(patch) },
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePteronUserAction(
  id: string,
  alsoDeletePterodactyl = false,
): Promise<Ok<Record<string, never>> | Fail> {
  try {
    const me = await admin();
    if (id === me.id) {
      return {
        ok: false,
        error: 'failed',
        detail: '자기 자신은 삭제할 수 없습니다.',
      };
    }

    const target = await prisma.user.findUnique({ where: { id } });
    await prisma.user.delete({ where: { id } });

    if (alsoDeletePterodactyl && target?.pteroUserId) {
      await deletePteroUser(target.pteroUserId).catch((err) => {
        console.error('ptero user delete failed', err);
      });
    }

    await audit('admin.user.delete', { userId: me.id, target: id });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
