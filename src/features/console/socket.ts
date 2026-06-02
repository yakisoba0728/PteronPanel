import type { PowerSignal, WebsocketCredentials } from '@/lib/ptero/types';

export interface ConsoleStats {
  memory_bytes: number;
  cpu_absolute: number;
  disk_bytes: number;
  network: { rx_bytes: number; tx_bytes: number };
  uptime: number;
  state: string;
}

export type ConsoleEvent =
  | { type: 'open' }
  | { type: 'status'; status: string }
  | { type: 'console'; line: string }
  | { type: 'stats'; stats: ConsoleStats }
  | { type: 'daemon'; message: string }
  | { type: 'error'; message: string }
  | { type: 'close'; code: number; suspended: boolean };

interface WingsMessage {
  event: string;
  args?: string[];
}

type WsCtor = { new (url: string): WebSocket };
const WS_OPEN = 1;
export const CONSOLE_TOKEN_REFRESH_MS = 7 * 60_000;

export interface ConsoleSocketDeps {
  getCredentials: () => Promise<WebsocketCredentials>;
  onEvent: (event: ConsoleEvent) => void;
  WebSocketImpl?: WsCtor;
}

export class ConsoleSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private queue: string[] = [];
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly WS: WsCtor;

  constructor(private readonly deps: ConsoleSocketDeps) {
    this.WS = deps.WebSocketImpl ?? (globalThis.WebSocket as unknown as WsCtor);
  }

  async connect(): Promise<void> {
    this.clearTokenRefreshTimer();
    // Tear down any existing socket before opening a new one. Detaching the
    // handlers (and closing) prevents a late onclose/onmessage/onerror from the
    // old, now-orphaned socket from racing the new one (e.g. scheduling a second
    // reconnect or a duplicate token-refresh timer).
    this.teardownSocket();

    const creds = await this.deps.getCredentials();
    const ws = new this.WS(creds.socket);
    this.ws = ws;

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.reconnectAttempts = 0;
      this.send('auth', [creds.token]);
      this.flushQueue();
      this.scheduleTokenRefresh();
      this.deps.onEvent({ type: 'open' });
    };
    ws.onmessage = (event: MessageEvent) => {
      if (ws !== this.ws) return;
      void this.handleMessage(typeof event.data === 'string' ? event.data : '');
    };
    ws.onclose = (event: CloseEvent) => {
      if (ws !== this.ws) return;
      this.handleClose(event.code);
    };
    ws.onerror = () => {
      if (ws !== this.ws) return;
      this.deps.onEvent({ type: 'error', message: 'WebSocket error' });
    };
  }

  sendCommand(command: string): void {
    this.send('send command', [command]);
  }

  setState(signal: PowerSignal): void {
    this.send('set state', [signal]);
  }

  requestLogs(): void {
    this.send('send logs', []);
  }

  requestStats(): void {
    this.send('send stats', []);
  }

  close(): void {
    this.closedByUser = true;
    this.clearTokenRefreshTimer();
    this.teardownSocket();
  }

  /**
   * Detach all handlers from the current socket and close it. Nulling the
   * handlers first guarantees the old socket can no longer drive any state
   * transitions (reconnect, token refresh, event emission) once a new socket
   * has taken its place.
   */
  private teardownSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      // closing an already-closed socket can throw in some environments; ignore.
    }
  }

  private send(event: string, args: string[]): void {
    const payload = JSON.stringify({ event, args });
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      this.queue.push(payload);
      return;
    }
    this.ws.send(payload);
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return;
    const queued = this.queue;
    this.queue = [];
    for (const payload of queued) this.ws.send(payload);
  }

  private async handleMessage(raw: string): Promise<void> {
    if (!raw) return;

    let message: WingsMessage;
    try {
      message = JSON.parse(raw) as WingsMessage;
    } catch {
      return;
    }

    const arg0 = message.args?.[0] ?? '';

    switch (message.event) {
      case 'auth success':
        break;
      case 'status':
        this.deps.onEvent({ type: 'status', status: arg0 });
        break;
      case 'console output':
        this.deps.onEvent({ type: 'console', line: arg0 });
        break;
      case 'stats':
        this.emitStats(arg0);
        break;
      case 'daemon message':
        this.deps.onEvent({ type: 'daemon', message: arg0 });
        break;
      case 'token expiring':
        // The current socket is still authenticated; refresh in place.
        await this.refreshToken();
        break;
      case 'token expired':
        // The socket's auth has already lapsed — re-authing on the same socket
        // is useless. Close it and let the exponential-backoff reconnect
        // re-establish and re-auth on a fresh socket.
        this.ws?.close();
        break;
      case 'jwt error':
      case 'daemon error':
        this.deps.onEvent({ type: 'error', message: arg0 || 'daemon error' });
        break;
      default:
        break;
    }
  }

  private emitStats(json: string): void {
    try {
      const stats = JSON.parse(json) as Partial<ConsoleStats>;
      this.deps.onEvent({
        type: 'stats',
        stats: {
          memory_bytes: stats.memory_bytes ?? 0,
          cpu_absolute: stats.cpu_absolute ?? 0,
          disk_bytes: stats.disk_bytes ?? 0,
          network: {
            rx_bytes: stats.network?.rx_bytes ?? 0,
            tx_bytes: stats.network?.tx_bytes ?? 0,
          },
          uptime: stats.uptime ?? 0,
          state: stats.state ?? 'unknown',
        },
      });
    } catch {
      // ignore malformed stats frames
    }
  }

  private async refreshToken(): Promise<void> {
    try {
      const creds = await this.deps.getCredentials();
      this.send('auth', [creds.token]);
      this.scheduleTokenRefresh();
    } catch {
      this.deps.onEvent({ type: 'error', message: 'Failed to refresh console token' });
    }
  }

  private scheduleTokenRefresh(): void {
    this.clearTokenRefreshTimer();
    this.tokenRefreshTimer = setTimeout(() => {
      if (!this.closedByUser) void this.refreshToken();
    }, CONSOLE_TOKEN_REFRESH_MS);
  }

  private clearTokenRefreshTimer(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer);
    this.tokenRefreshTimer = null;
  }

  private handleClose(code: number): void {
    this.clearTokenRefreshTimer();
    const suspended = code === 4409;
    this.deps.onEvent({ type: 'close', code, suspended });

    if (this.closedByUser || suspended) return;

    const delay = Math.min(10_000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;

    setTimeout(() => {
      if (!this.closedByUser) {
        void this.connect();
      }
    }, delay);
  }
}
