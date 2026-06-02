'use server';

import { z } from 'zod';
import { audit } from '@/lib/audit';
import { requireUser } from '@/lib/auth/current-user';
import { encryptSecret } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import {
  generatePluginToken,
  generateWebhookSecret,
  hashPluginToken,
} from '@/lib/plugins/token';

type Fail = { ok: false; error: 'validation' | 'not_found' | 'failed'; detail?: string };
type Ok<T extends object = object> = { ok: true } & T;

export interface PluginRow {
  id: string;
  name: string;
  description: string | null;
  webhookUrl: string | null;
  events: string[];
  uiTabUrl: string | null;
  uiTabLabel: string | null;
  enabled: boolean;
}

const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'http/https only');

const RegisterSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  webhookUrl: httpUrl.optional(),
  uiTabUrl: httpUrl.optional(),
  uiTabLabel: z.string().max(40).optional(),
  events: z.array(z.string().regex(/^[a-z]+\.[a-z_]+$/)).default([]),
});

function row(plugin: PluginRow): PluginRow {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    webhookUrl: plugin.webhookUrl,
    events: plugin.events,
    uiTabUrl: plugin.uiTabUrl,
    uiTabLabel: plugin.uiTabLabel,
    enabled: plugin.enabled,
  };
}

export async function listPluginsAction(): Promise<Ok<{ plugins: PluginRow[] }> | Fail> {
  const user = await requireUser();
  const plugins = await prisma.plugin.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: 'asc' },
  });

  return { ok: true, plugins: plugins.map(row) };
}

export async function registerPluginAction(
  input: z.infer<typeof RegisterSchema>,
): Promise<Ok<{ id: string; token: string; webhookSecret: string }> | Fail> {
  const user = await requireUser();
  const parsed = RegisterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation',
      detail: parsed.error.issues[0]?.message,
    };
  }

  const data = parsed.data;
  const token = generatePluginToken();
  const webhookSecret = generateWebhookSecret();
  const created = await prisma.plugin.create({
    data: {
      ownerId: user.id,
      name: data.name,
      description: data.description,
      webhookUrl: data.webhookUrl,
      uiTabUrl: data.uiTabUrl,
      uiTabLabel: data.uiTabLabel,
      events: data.events,
      tokenHash: hashPluginToken(token),
      webhookSecretEnc: data.webhookUrl ? encryptSecret(webhookSecret) : null,
    },
  });

  await audit('plugin.register', {
    userId: user.id,
    target: created.id,
    metadata: { name: data.name },
  });

  return { ok: true, id: created.id, token, webhookSecret };
}

async function ownPlugin(userId: string, id: string) {
  return prisma.plugin.findFirst({ where: { id, ownerId: userId } });
}

export async function setPluginEnabledAction(
  id: string,
  enabled: boolean,
): Promise<Ok | Fail> {
  const user = await requireUser();
  if (!(await ownPlugin(user.id, id))) return { ok: false, error: 'not_found' };

  await prisma.plugin.update({ where: { id }, data: { enabled } });
  await audit('plugin.toggle', {
    userId: user.id,
    target: id,
    metadata: { enabled },
  });

  return { ok: true };
}

export async function rotatePluginTokenAction(id: string): Promise<Ok<{ token: string }> | Fail> {
  const user = await requireUser();
  if (!(await ownPlugin(user.id, id))) return { ok: false, error: 'not_found' };

  const token = generatePluginToken();
  await prisma.plugin.update({ where: { id }, data: { tokenHash: hashPluginToken(token) } });
  await audit('plugin.rotate', { userId: user.id, target: id });

  return { ok: true, token };
}

export async function deletePluginAction(id: string): Promise<Ok | Fail> {
  const user = await requireUser();
  if (!(await ownPlugin(user.id, id))) return { ok: false, error: 'not_found' };

  await prisma.plugin.delete({ where: { id } });
  await audit('plugin.delete', { userId: user.id, target: id });

  return { ok: true };
}
