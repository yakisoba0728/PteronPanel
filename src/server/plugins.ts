'use server';

import { z } from 'zod';
import { audit } from '@/lib/audit';
import { requireUser } from '@/lib/auth/current-user';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { generateContextToken } from '@/lib/plugins/context-token';
import { deliverWebhook } from '@/lib/plugins/webhook';
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

export interface DeliveryRow {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  createdAt: string;
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

export async function listDeliveriesAction(
  pluginId: string,
): Promise<Ok<{ deliveries: DeliveryRow[] }> | Fail> {
  const user = await requireUser();
  const plugin = await prisma.plugin.findFirst({
    where: { id: pluginId, ownerId: user.id },
  });
  if (!plugin) return { ok: false, error: 'not_found' };

  const rows = await prisma.webhookDelivery.findMany({
    where: { pluginId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return {
    ok: true,
    deliveries: rows.map((delivery) => ({
      id: delivery.id,
      event: delivery.event,
      status: delivery.status,
      attempts: delivery.attempts,
      responseCode: delivery.responseCode,
      createdAt: delivery.createdAt.toISOString(),
    })),
  };
}

export async function retryDeliveryAction(
  pluginId: string,
  deliveryId: string,
): Promise<Ok | Fail> {
  const user = await requireUser();
  const plugin = await prisma.plugin.findFirst({
    where: { id: pluginId, ownerId: user.id },
  });
  if (!plugin || !plugin.webhookUrl || !plugin.webhookSecretEnc) {
    return { ok: false, error: 'not_found' };
  }

  const delivery = await prisma.webhookDelivery.findFirst({
    where: { id: deliveryId, pluginId },
  });
  if (!delivery) return { ok: false, error: 'not_found' };

  const payload = {
    id: delivery.id,
    event: delivery.event,
    server: null,
    actor: null,
    data: {},
    retry: true,
  };
  const result = await deliverWebhook(
    plugin.webhookUrl,
    decryptSecret(plugin.webhookSecretEnc),
    payload,
  );
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: result.ok ? 'success' : 'failed',
      attempts: { increment: 1 },
      responseCode: result.status ?? null,
      error: result.error ?? null,
    },
  });

  return { ok: true };
}

export async function getPluginContextAction(pluginId: string): Promise<Ok<{ token: string }> | Fail> {
  const user = await requireUser();
  const plugin = await prisma.plugin.findFirst({
    where: { id: pluginId, ownerId: user.id, enabled: true, uiTabUrl: { not: null } },
  });
  if (!plugin) return { ok: false, error: 'not_found' };

  return { ok: true, token: generateContextToken(plugin.id, user.id, 5 * 60 * 1000) };
}
