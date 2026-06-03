import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import WebSocket, { WebSocketServer } from 'ws';
import { validateSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/constants';
import { resolveAccessibleServers } from '@/lib/authz/access';
import { bridgeConsole } from '@/lib/console/proxy';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.split('=')[1];
}

function isAllowedWsOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const configuredBase = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL) : null;
    if (configuredBase && originUrl.origin === configuredBase.origin) return true;

    return Boolean(
      host &&
        originUrl.host === host &&
        (originUrl.protocol === 'http:' || originUrl.protocol === 'https:'),
    );
  } catch {
    return false;
  }
}

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res, parse(req.url!, true)));
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const { pathname, query } = parse(req.url!, true);
    if (pathname !== '/api/console/ws') return socket.destroy();
    try {
      if (!isAllowedWsOrigin(req.headers.origin, req.headers.host)) return socket.destroy();
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const session = token ? await validateSessionToken(token) : null;
      if (!session) return socket.destroy();
      const identifier = String(query.server ?? '');
      const servers = await resolveAccessibleServers({ id: session.user.id, role: session.user.role, pteroUserId: session.user.pteroUserId });
      const match = servers.find((s) => s.identifier === identifier);
      if (!match) return socket.destroy();
      const viewer = { accessKind: match.accessKind ?? 'subuser', permissions: match.permissions ?? [] };
      wss.handleUpgrade(req, socket, head, (browser) => {
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
