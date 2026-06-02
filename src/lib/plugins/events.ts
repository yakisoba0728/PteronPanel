import type { Prisma } from '@prisma/client';
import { decryptSecret } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { resolveAccessibleServers, type ScopeUser } from '@/lib/authz/access';
import { deliverWebhook } from './webhook';

export interface EventPayloadInput {
  serverIdentifier: string;
  actorUserId?: string;
  data?: Prisma.InputJsonObject;
}

export interface TargetPlugin {
  id: string;
  ownerId: string;
  webhookUrl: string;
  webhookSecretEnc: string;
}

/** Plugins that should receive an event about a server. */
export async function selectTargetPlugins(
  event: string,
  serverIdentifier: string,
): Promise<TargetPlugin[]> {
  const candidates = await prisma.plugin.findMany({
    where: { enabled: true, webhookUrl: { not: null }, events: { has: event } },
  });
  const accessByOwner = new Map<string, Set<string>>();
  const out: TargetPlugin[] = [];

  for (const plugin of candidates) {
    if (!plugin.webhookUrl || !plugin.webhookSecretEnc) continue;

    let access = accessByOwner.get(plugin.ownerId);
    if (!access) {
      const owner = await prisma.user.findUnique({
        where: { id: plugin.ownerId },
        select: { id: true, role: true, pteroUserId: true, isActive: true },
      });
      const servers = owner?.isActive
        ? await resolveAccessibleServers(owner as ScopeUser)
        : [];
      access = new Set(servers.map((server) => String(server.identifier)));
      accessByOwner.set(plugin.ownerId, access);
    }

    if (access.has(serverIdentifier)) {
      out.push({
        id: plugin.id,
        ownerId: plugin.ownerId,
        webhookUrl: plugin.webhookUrl,
        webhookSecretEnc: plugin.webhookSecretEnc,
      });
    }
  }

  return out;
}

/** Fire-and-forget dispatcher body. Never throws into action callers. */
export async function emitEvent(event: string, input: EventPayloadInput): Promise<void> {
  try {
    const targets = await selectTargetPlugins(event, input.serverIdentifier);
    await dispatchEventToTargets(event, input, targets);
  } catch (err) {
    console.error('emitEvent failed', { event, err });
  }
}

export async function dispatchEventToTargets(
  event: string,
  input: EventPayloadInput,
  targets: TargetPlugin[],
): Promise<void> {
  await Promise.all(
    targets.map(async (target) => {
      const delivery = await prisma.webhookDelivery.create({
        data: { pluginId: target.id, event, status: 'pending' },
      });
      const payload: Prisma.InputJsonObject = {
        id: delivery.id,
        event,
        server: input.serverIdentifier,
        actor: input.actorUserId ?? null,
        timestamp: new Date().toISOString(),
        data: input.data ?? {},
      };
      const result = await deliverWebhook(
        target.webhookUrl,
        decryptSecret(target.webhookSecretEnc),
        payload,
      );
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          payload,
          status: result.ok ? 'success' : 'failed',
          attempts: { increment: result.attempts },
          responseCode: result.status ?? null,
          error: result.error ?? null,
        },
      });
    }),
  );
}
