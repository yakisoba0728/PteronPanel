'use server';

import type { User } from '@prisma/client';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { requireUser } from '@/lib/auth/current-user';
import type { ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
import {
  asIdentifier,
  type ScheduleTask,
  type ServerSchedule,
} from '@/lib/ptero/types';

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
  console.error('schedule action failed', err);
  return { ok: false, error: 'failed', detail };
}

const cronField = z.string().min(1).max(8);
const scheduleSchema = z.object({
  name: z.string().min(1).max(191),
  minute: cronField,
  hour: cronField,
  day_of_month: cronField,
  month: cronField,
  day_of_week: cronField,
  is_active: z.boolean().optional(),
  only_when_online: z.boolean().optional(),
});
const taskSchema = z.object({
  action: z.enum(['command', 'power', 'backup']),
  payload: z.string(),
  time_offset: z.number().int().min(0).max(900),
  continue_on_failure: z.boolean().optional(),
});

export async function listSchedulesAction(
  identifier: string,
): Promise<Ok<{ schedules: ServerSchedule[] }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, schedules: await ptero.listSchedules(id) };
  } catch (err) {
    return toFail(err);
  }
}

export async function createScheduleAction(
  identifier: string,
  input: z.infer<typeof scheduleSchema>,
): Promise<Ok<{ schedule: ServerSchedule }> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    const data = scheduleSchema.parse(input);
    const schedule = await ptero.createSchedule(id, data);
    await audit('schedule.create', {
      userId: user.id,
      target: id,
      metadata: { name: data.name },
    });
    return { ok: true, schedule };
  } catch (err) {
    return toFail(err);
  }
}

export async function updateScheduleAction(
  identifier: string,
  schedId: number,
  input: z.infer<typeof scheduleSchema>,
): Promise<Ok<{ schedule: ServerSchedule }> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    const data = scheduleSchema.parse(input);
    const schedule = await ptero.updateSchedule(id, schedId, data);
    await audit('schedule.update', {
      userId: user.id,
      target: id,
      metadata: { schedId, name: data.name },
    });
    return { ok: true, schedule };
  } catch (err) {
    return toFail(err);
  }
}

export async function executeScheduleAction(
  identifier: string,
  schedId: number,
): Promise<Ok | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.executeSchedule(id, schedId);
    await audit('schedule.execute', {
      userId: user.id,
      target: id,
      metadata: { schedId },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteScheduleAction(
  identifier: string,
  schedId: number,
): Promise<Ok | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.deleteSchedule(id, schedId);
    await audit('schedule.delete', {
      userId: user.id,
      target: id,
      metadata: { schedId },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function createTaskAction(
  identifier: string,
  schedId: number,
  input: z.infer<typeof taskSchema>,
): Promise<Ok<{ task: ScheduleTask }> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    const data = taskSchema.parse(input);
    const task = await ptero.createTask(id, schedId, data);
    await audit('schedule.task.create', {
      userId: user.id,
      target: id,
      metadata: { schedId, action: data.action },
    });
    return { ok: true, task };
  } catch (err) {
    return toFail(err);
  }
}

export async function updateTaskAction(
  identifier: string,
  schedId: number,
  taskId: number,
  input: z.infer<typeof taskSchema>,
): Promise<Ok<{ task: ScheduleTask }> | Fail> {
  try {
    const { user, id } = await guard(identifier);
    const data = taskSchema.parse(input);
    const task = await ptero.updateTask(id, schedId, taskId, data);
    await audit('schedule.task.update', {
      userId: user.id,
      target: id,
      metadata: { schedId, taskId, action: data.action },
    });
    return { ok: true, task };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteTaskAction(
  identifier: string,
  schedId: number,
  taskId: number,
): Promise<Ok | Fail> {
  try {
    const { user, id } = await guard(identifier);
    await ptero.deleteTask(id, schedId, taskId);
    await audit('schedule.task.delete', {
      userId: user.id,
      target: id,
      metadata: { schedId, taskId },
    });
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}
