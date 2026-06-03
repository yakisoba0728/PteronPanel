/**
 * Frame-only Content-Security-Policy.
 *
 * We intentionally set ONLY frame directives so the rest of the app (console
 * WebSocket, xterm inline styles, signed-URL uploads to Wings nodes) is
 * unaffected. A fuller CSP lockdown is tracked as separate follow-up work.
 */

export const FRAME_CSP_BASELINE = "frame-src 'none'; frame-ancestors 'none'";

const PLUGIN_PATH = /^\/servers\/[^/]+\/plugin\/([^/]+)\/?$/;

/** Pathnames that should NOT receive a CSP header (static assets, APIs). */
export function shouldSetCsp(pathname: string): boolean {
  return !(
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') ||
    pathname === '/favicon.ico'
  );
}

/** The pluginId of a plugin tab route, or null when the path is not one. */
export function pluginIdFromPath(pathname: string): string | null {
  return PLUGIN_PATH.exec(pathname)?.[1] ?? null;
}

/**
 * Build the frame-only CSP. With a resolved plugin origin, allow framing it
 * (plus self); otherwise deny all framing.
 *
 * `pluginOrigin` is interpolated verbatim, so callers MUST pass a sanitized
 * `scheme://host[:port]` token (see getEnabledPluginUiOrigin) — never raw input.
 */
export function buildFrameCsp(pluginOrigin: string | null): string {
  if (!pluginOrigin) return FRAME_CSP_BASELINE;
  return `frame-src 'self' ${pluginOrigin}; frame-ancestors 'none'`;
}
