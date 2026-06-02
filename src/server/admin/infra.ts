'use server';

import { z } from 'zod';
import { audit } from '@/lib/audit';
import { requireUser } from '@/lib/auth/current-user';
import { assertAdmin, AdminRequiredError } from '@/lib/authz/admin';
import { PteroApiError } from '@/lib/ptero/errors';
import * as app from '@/lib/ptero/application';
import type { PteroLocation, PteroNode } from '@/lib/ptero/types';

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
  console.error('admin infra action failed', err);
  return { ok: false, error: 'failed', detail };
}

export async function listNodesAction(): Promise<
  Ok<{ nodes: PteroNode[] }> | Fail
> {
  try {
    await admin();
    return { ok: true, nodes: await app.listNodes() };
  } catch (err) {
    return fail(err);
  }
}

export async function listLocationsAction(): Promise<
  Ok<{ locations: PteroLocation[] }> | Fail
> {
  try {
    await admin();
    return { ok: true, locations: await app.listLocations() };
  } catch (err) {
    return fail(err);
  }
}

const LocationSchema = z.object({
  short: z.string().min(1).max(60),
  long: z.string().max(191).optional(),
});

export async function createLocationAction(
  input: z.infer<typeof LocationSchema>,
): Promise<Ok<{ id: number }> | Fail> {
  try {
    const me = await admin();
    const data = LocationSchema.parse(input);
    const loc = await app.createLocation(data);
    await audit('admin.location.create', {
      userId: me.id,
      target: String(loc.id),
    });
    return { ok: true, id: loc.id };
  } catch (err) {
    return fail(err);
  }
}

export async function updateLocationAction(
  id: number,
  input: Partial<z.infer<typeof LocationSchema>>,
): Promise<Ok<Record<string, never>> | Fail> {
  try {
    const me = await admin();
    const data = LocationSchema.partial().parse(input);
    await app.updateLocation(id, data);
    await audit('admin.location.update', {
      userId: me.id,
      target: String(id),
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteLocationAction(
  id: number,
): Promise<Ok<Record<string, never>> | Fail> {
  try {
    const me = await admin();
    await app.deleteLocation(id);
    await audit('admin.location.delete', {
      userId: me.id,
      target: String(id),
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
