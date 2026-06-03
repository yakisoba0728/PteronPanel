import WebSocket from 'ws';
import { getWebsocketCredentials } from '@/lib/ptero/client';
import { asIdentifier } from '@/lib/ptero/types';
import { isInboundAllowed, type Viewer } from './frame-policy';

const REFRESH_MS = 8 * 60 * 1000;

function safeCloseCode(code: number): number {
  if (code >= 3000 && code <= 4999) return code;
  if (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) {
    return code;
  }
  return 1011;
}

/** Bridge a browser socket to the server's Wings console socket, enforcing `viewer` permissions on inbound frames. */
export async function bridgeConsole(browser: WebSocket, identifier: string, viewer: Viewer): Promise<void> {
  const id = asIdentifier(identifier);
  let creds = await getWebsocketCredentials(id);
  const upstream = new WebSocket(creds.socket);
  let refreshTimer: NodeJS.Timeout | null = null;

  const authUpstream = () => upstream.send(JSON.stringify({ event: 'auth', args: [creds.token] }));
  const cleanup = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  };

  upstream.on('open', () => {
    authUpstream();
    refreshTimer = setInterval(async () => {
      try { creds = await getWebsocketCredentials(id); authUpstream(); }
      catch { /* will retry next tick */ }
    }, REFRESH_MS);
  });
  upstream.on('message', (data) => { if (browser.readyState === WebSocket.OPEN) browser.send(data.toString()); });
  upstream.on('close', (code) => { cleanup(); if (browser.readyState === WebSocket.OPEN) browser.close(safeCloseCode(code)); });
  upstream.on('error', () => { if (browser.readyState === WebSocket.OPEN) browser.close(1011); });

  browser.on('message', (raw) => {
    let frame: { event: string; args?: string[] };
    try { frame = JSON.parse(raw.toString()); } catch { return; }
    if (frame.event === 'auth') return;
    if (!isInboundAllowed(viewer, frame)) {
      if (browser.readyState === WebSocket.OPEN) {
        browser.send(JSON.stringify({ event: 'daemon error', args: ['권한이 없습니다.'] }));
      }
      return;
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(raw.toString());
  });
  browser.on('close', cleanup);
  browser.on('error', cleanup);
}
