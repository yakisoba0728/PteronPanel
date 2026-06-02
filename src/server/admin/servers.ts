'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/current-user';
import { assertAdmin, AdminRequiredError } from '@/lib/authz/admin';
import * as app from '@/lib/ptero/application';
import type { PteroServer, PteroNest, PteroEgg } from '@/lib/ptero/types';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';

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
  console.error('admin server action failed', err);
  return { ok: false, error: 'failed', detail };
}

export async function listServersAction(): Promise<
  OkWith<{ servers: PteroServer[] }> | Fail
> {
  try {
    await admin();
    return { ok: true, servers: await app.listAllServers() };
  } catch (err) {
    return fail(err);
  }
}

export async function listNestsAction(): Promise<
  OkWith<{ nests: PteroNest[] }> | Fail
> {
  try {
    await admin();
    return { ok: true, nests: await app.listNests() };
  } catch (err) {
    return fail(err);
  }
}

export async function listEggsAction(
  nestId: number,
): Promise<OkWith<{ eggs: PteroEgg[] }> | Fail> {
  try {
    await admin();
    return { ok: true, eggs: await app.listEggs(nestId) };
  } catch (err) {
    return fail(err);
  }
}

export async function getEggAction(
  nestId: number,
  eggId: number,
): Promise<OkWith<{ egg: PteroEgg }> | Fail> {
  try {
    await admin();
    return { ok: true, egg: await app.getEgg(nestId, eggId) };
  } catch (err) {
    return fail(err);
  }
}

const CreateSchema = z.object({
  name: z.string().min(1).max(191),
  user: z.number().int().positive(),
  egg: z.number().int().positive(),
  dockerImage: z.string().min(1),
  startup: z.string().min(1),
  environment: z.record(z.string()),
  limits: z.object({
    memory: z.number().int().min(0),
    swap: z.number().int().min(-1),
    disk: z.number().int().min(0),
    io: z.number().int().min(10).max(1000),
    cpu: z.number().int().min(0),
  }),
  featureLimits: z.object({
    databases: z.number().int().min(0),
    allocations: z.number().int().min(0),
    backups: z.number().int().min(0),
  }),
  locationIds: z.array(z.number().int().positive()).min(1),
  portRange: z.array(z.string()).min(1),
  startOnCompletion: z.boolean().optional(),
});

export async function createServerAction(
  input: z.infer<typeof CreateSchema>,
): Promise<OkWith<{ id: number }> | Fail> {
  try {
    const me = await admin();
    const data = CreateSchema.parse(input);
    const server = await app.createServer({
      name: data.name,
      user: data.user,
      egg: data.egg,
      docker_image: data.dockerImage,
      startup: data.startup,
      environment: data.environment,
      limits: data.limits,
      feature_limits: data.featureLimits,
      deploy: {
        locations: data.locationIds,
        dedicated_ip: false,
        port_range: data.portRange,
      },
      start_on_completion: data.startOnCompletion ?? false,
    });
    await audit('admin.server.create', {
      userId: me.id,
      target: String(server.id),
      metadata: { name: data.name, egg: data.egg },
    });
    return { ok: true, id: server.id };
  } catch (err) {
    return fail(err);
  }
}

export async function setServerSuspendedAction(
  id: number,
  suspended: boolean,
): Promise<Ok | Fail> {
  try {
    const me = await admin();
    if (suspended) {
      await app.suspendServer(id);
    } else {
      await app.unsuspendServer(id);
    }
    await audit(suspended ? 'admin.server.suspend' : 'admin.server.unsuspend', {
      userId: me.id,
      target: String(id),
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reinstallServerAction(
  id: number,
): Promise<Ok | Fail> {
  try {
    const me = await admin();
    await app.reinstallServer(id);
    await audit('admin.server.reinstall', {
      userId: me.id,
      target: String(id),
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteServerAction(
  id: number,
  force = false,
): Promise<Ok | Fail> {
  try {
    const me = await admin();
    await app.deleteServer(id, force);
    await audit('admin.server.delete', {
      userId: me.id,
      target: String(id),
      metadata: { force },
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function renameServerAction(
  id: number,
  name: string,
): Promise<Ok | Fail> {
  try {
    const me = await admin();
    await app.updateServerDetails(id, { name });
    await audit('admin.server.rename', {
      userId: me.id,
      target: String(id),
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const BuildSchema = z.object({
  allocation: z.number().int().positive().optional(),
  limits: z.object({
    memory: z.number().int().min(0),
    swap: z.number().int().min(-1),
    disk: z.number().int().min(0),
    io: z.number().int().min(10).max(1000),
    cpu: z.number().int().min(0),
  }),
  featureLimits: z.object({
    databases: z.number().int().min(0),
    allocations: z.number().int().min(0),
    backups: z.number().int().min(0),
  }),
});

export async function updateServerBuildAction(
  id: number,
  input: z.infer<typeof BuildSchema>,
): Promise<Ok | Fail> {
  try {
    const me = await admin();
    const data = BuildSchema.parse(input);
    await app.updateServerBuild(id, {
      allocation: data.allocation,
      memory: data.limits.memory,
      swap: data.limits.swap,
      disk: data.limits.disk,
      io: data.limits.io,
      cpu: data.limits.cpu,
      feature_limits: data.featureLimits,
    });
    await audit('admin.server.update_build', {
      userId: me.id,
      target: String(id),
      metadata: { allocation: data.allocation },
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const StartupSchema = z.object({
  startup: z.string().min(1),
  egg: z.number().int().positive(),
  image: z.string().min(1),
  environment: z.record(z.string()),
  skipScripts: z.boolean().optional(),
});

export async function updateServerStartupAction(
  id: number,
  input: z.infer<typeof StartupSchema>,
): Promise<Ok | Fail> {
  try {
    const me = await admin();
    const data = StartupSchema.parse(input);
    await app.updateServerStartup(id, {
      startup: data.startup,
      egg: data.egg,
      image: data.image,
      environment: data.environment,
      skip_scripts: data.skipScripts,
    });
    await audit('admin.server.update_startup', {
      userId: me.id,
      target: String(id),
      metadata: { egg: data.egg },
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
