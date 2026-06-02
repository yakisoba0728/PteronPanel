import type { ScopeUser } from '@/lib/authz/access';
import { prisma } from '@/lib/db';
import { hashPluginToken } from './token';

export interface PluginContext {
  pluginId: string;
  owner: ScopeUser;
}

export async function authenticatePlugin(req: Request): Promise<PluginContext | null> {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token?.startsWith('ptex_')) return null;

  const plugin = await prisma.plugin.findUnique({
    where: { tokenHash: hashPluginToken(token) },
  });
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
