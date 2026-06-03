import { prisma } from '@/lib/db';

/**
 * Resolve the origin of an enabled plugin's uiTabUrl, for CSP frame-src.
 *
 * Returns null when the plugin is missing, disabled, has no uiTabUrl, or the
 * stored URL cannot be parsed. Looked up by id only — the plugin tab page
 * enforces ownership (404 for non-owners) and the origin is not secret.
 */
export async function getEnabledPluginUiOrigin(pluginId: string): Promise<string | null> {
  const plugin = await prisma.plugin.findFirst({
    where: { id: pluginId, enabled: true, uiTabUrl: { not: null } },
    select: { uiTabUrl: true },
  });
  if (!plugin?.uiTabUrl) return null;
  try {
    return new URL(plugin.uiTabUrl).origin;
  } catch {
    return null;
  }
}
