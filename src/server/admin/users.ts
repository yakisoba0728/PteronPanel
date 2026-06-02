'use server';

import { Prisma } from '@prisma/client';
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
type Ok = { ok: true };
type OkWith<T> = Ok & T;

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

function failed(detail: string): Fail {
  return { ok: false, error: 'failed', detail };
}

const DUPLICATE_DETAIL =
  '이미 사용 중인 이메일 또는 매핑된 Pterodactyl 유저입니다.';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
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
  OkWith<{ users: PteronUserRow[] }> | Fail
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
): Promise<OkWith<{ id: string }> | Fail> {
  try {
    const me = await admin();
    const data = CreateSchema.parse(input);
    let mapping = await findUserByEmail(data.email);
    let createdPteroUserId: number | null = null;

    if (!mapping && data.createPterodactyl) {
      const created = await createPteroUser({
        email: data.email,
        username: data.username,
        first_name: data.firstName ?? data.username,
        last_name: data.lastName ?? '-',
        password: data.password,
      });
      mapping = { id: created.id, uuid: created.uuid };
      createdPteroUserId = created.id;
    }

    let user: { id: string };
    try {
      user = await prisma.user.create({
        data: {
          email: data.email.toLowerCase(),
          username: data.username,
          passwordHash: await hashPassword(data.password),
          role: data.role,
          pteroUserId: mapping?.id,
          pteroUuid: mapping?.uuid,
        },
      });
    } catch (err) {
      if (createdPteroUserId) {
        try {
          await deletePteroUser(createdPteroUserId);
        } catch (deleteErr) {
          console.error('compensating ptero user delete failed', deleteErr);
          await audit('admin.user.create_orphan', {
            userId: me.id,
            metadata: { pteroUserId: createdPteroUserId },
          });
          return failed(
            `Pterodactyl 유저(#${createdPteroUserId})가 생성되었으나 로컬 계정 생성에 실패했고, 정리(삭제)도 실패했습니다. 수동으로 정리해야 합니다.`,
          );
        }
      }
      if (isUniqueViolation(err)) {
        return failed(DUPLICATE_DETAIL);
      }
      throw err;
    }

    await audit('admin.user.create', {
      userId: me.id,
      target: user.id,
      metadata: { role: data.role, mapped: Boolean(mapping) },
    });

    return { ok: true, id: user.id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return failed(DUPLICATE_DETAIL);
    }
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
): Promise<Ok | Fail> {
  try {
    const me = await admin();
    const data = UpdateSchema.parse(input);

    if (data.id === me.id && data.role && data.role !== 'ADMIN') {
      return failed('자기 자신의 관리자 권한은 해제할 수 없습니다.');
    }
    if (data.id === me.id && data.isActive === false) {
      return failed('자기 자신은 비활성화할 수 없습니다.');
    }

    if (data.role === 'USER' || data.isActive === false) {
      const target = await prisma.user.findUnique({
        where: { id: data.id },
        select: { role: true, isActive: true },
      });
      if (target?.role === 'ADMIN' && target.isActive) {
        const activeAdmins = await prisma.user.count({
          where: { role: 'ADMIN', isActive: true },
        });
        if (activeAdmins <= 1) {
          return failed('최소 한 명의 활성 관리자가 필요합니다.');
        }
      }
    }

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

    if (Object.keys(patch).length === 0) {
      return { ok: true };
    }

    await prisma.user.update({ where: { id: data.id }, data: patch });
    await audit('admin.user.update', {
      userId: me.id,
      target: data.id,
      metadata: { fields: Object.keys(patch) },
    });
    return { ok: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return failed(DUPLICATE_DETAIL);
    }
    return fail(err);
  }
}

export async function deletePteronUserAction(
  id: string,
  alsoDeletePterodactyl = false,
): Promise<Ok | Fail> {
  try {
    const me = await admin();
    if (id === me.id) {
      return failed('자기 자신은 삭제할 수 없습니다.');
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (alsoDeletePterodactyl && target?.pteroUserId) {
      await deletePteroUser(target.pteroUserId);
    }

    await prisma.user.delete({ where: { id } });
    await audit('admin.user.delete', {
      userId: me.id,
      target: id,
      metadata: { alsoDeletePterodactyl },
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
