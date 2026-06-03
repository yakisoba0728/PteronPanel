import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import WebSocket, { WebSocketServer } from 'ws';
import { getConfig } from '@/lib/config';
import { validateSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/constants';
import { resolveAccessibleServers } from '@/lib/authz/access';
import { bridgeConsole } from '@/lib/console/proxy';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Wings console frames are tiny; cap the payload so a hostile peer can't
// allocate large buffers through the proxy.
const MAX_WS_PAYLOAD = 64 * 1024;
// Max simultaneous console sockets a single user may hold open at once.
const MAX_CONSOLE_SOCKETS_PER_USER = 10;

const consoleSocketsByUser = new Map<string, number>();

function consoleSocketCount(userId: string): number {
  return consoleSocketsByUser.get(userId) ?? 0;
}

function acquireConsoleSocket(userId: string): void {
  consoleSocketsByUser.set(userId, consoleSocketCount(userId) + 1);
}

function releaseConsoleSocket(userId: string): void {
  const next = consoleSocketCount(userId) - 1;
  if (next <= 0) consoleSocketsByUser.delete(userId);
  else consoleSocketsByUser.set(userId, next);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.split('=')[1];
}

// Strict same-origin check (CSWSH hardening). Browsers always send `Origin`
// on WebSocket upgrades, so a missing/empty Origin is rejected. The only
// accepted origin is the panel's canonical public origin from APP_BASE_URL.
function isAllowedWsOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const expected = new URL(getConfig().APP_BASE_URL).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res, parse(req.url!, true)));
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });

  server.on('upgrade', async (req, socket, head) => {
    const { pathname, query } = parse(req.url!, true);
    if (pathname !== '/api/console/ws') return socket.destroy();
    try {
      if (!isAllowedWsOrigin(req.headers.origin)) return socket.destroy();
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const session = token ? await validateSessionToken(token) : null;
      if (!session) return socket.destroy();
      const identifier = String(query.server ?? '');
      const servers = await resolveAccessibleServers({ id: session.user.id, role: session.user.role, pteroUserId: session.user.pteroUserId });
      const match = servers.find((s) => s.identifier === identifier);
      if (!match) return socket.destroy();
      const userId = session.user.id;
      if (consoleSocketCount(userId) >= MAX_CONSOLE_SOCKETS_PER_USER) return socket.destroy();
      const viewer = { accessKind: match.accessKind ?? 'subuser', permissions: match.permissions ?? [] };
      wss.handleUpgrade(req, socket, head, (browser) => {
        acquireConsoleSocket(userId);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          releaseConsoleSocket(userId);
        };
        browser.once('close', release);
        void bridgeConsole(browser, identifier, viewer).catch(() => {
          if (browser.readyState === WebSocket.OPEN) browser.close(1011);
        });
      });
    } catch {
      socket.destroy();
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`> ready on :${port}`));
});
