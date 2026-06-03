import { prisma } from '@/lib/db';

// A clean CSP host-source: scheme://host[:port], where host is a domain/IPv4
// (letters, digits, dot, hyphen) or a bracketed IPv6 literal. Anything else —
// a space, ';', ',', "'", '*', or an opaque "null" origin — is rejected so a
// crafted uiTabUrl can never widen or inject directives in the frame-src header.
const SAFE_ORIGIN = /^https?:\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d+)?$/i;

/**
 * Resolve the origin of an enabled plugin's uiTabUrl, for CSP frame-src.
 *
 * Returns null when the plugin is missing, disabled, has no uiTabUrl, the
 * stored URL cannot be parsed, or its origin is not a clean http(s) host-source.
 * Looked up by id only — the plugin tab page enforces ownership (404 for
 * non-owners) and the origin is not secret.
 */
export async function getEnabledPluginUiOrigin(pluginId: string): Promise<string | null> {
  const plugin = await prisma.plugin.findFirst({
    where: { id: pluginId, enabled: true, uiTabUrl: { not: null } },
    select: { uiTabUrl: true },
  });
  if (!plugin?.uiTabUrl) return null;
  let origin: string;
  try {
    origin = new URL(plugin.uiTabUrl).origin;
  } catch {
    return null;
  }
  return SAFE_ORIGIN.test(origin) ? origin : null;
}
