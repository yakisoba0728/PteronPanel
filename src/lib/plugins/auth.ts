import type { ScopeUser } from '@/lib/authz/access';
import { prisma } from '@/lib/db';
import { verifyContextToken } from './context-token';
import { hashPluginToken } from './token';

export interface PluginContext {
  pluginId: string;
  owner: ScopeUser;
}

export async function authenticatePlugin(req: Request): Promise<PluginContext | null> {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  const plugin = token.startsWith('ptxc_')
    ? await pluginFromContextToken(token)
    : token.startsWith('ptex_')
      ? await prisma.plugin.findUnique({ where: { tokenHash: hashPluginToken(token) } })
      : null;
  if (!plugin?.enabled) return null;

  const owner = await prisma.user.findUnique({
    where: { id: plugin.ownerId },
    select: { id: true, role: true, pteroUserId: true, isActive: true },
  });
  if (!owner?.isActive) return null;

  return {
    pluginId: plugin.id,
    owner: {
      id: owner.id,
      role: owner.role,
      pteroUserId: owner.pteroUserId,
    },
  };
}

async function pluginFromContextToken(token: string) {
  const ctx = verifyContextToken(token);
  if (!ctx) return null;

  const plugin = await prisma.plugin.findUnique({ where: { id: ctx.pluginId } });
  if (plugin?.ownerId !== ctx.ownerId) return null;

  return plugin;
}
