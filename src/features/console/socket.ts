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

export interface ConsoleSocketDeps {
  getCredentials: () => Promise<WebsocketCredentials>;
  onEvent: (event: ConsoleEvent) => void;
  WebSocketImpl?: WsCtor;
}

export class ConsoleSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private readonly WS: WsCtor;

  constructor(private readonly deps: ConsoleSocketDeps) {
    this.WS = deps.WebSocketImpl ?? (globalThis.WebSocket as unknown as WsCtor);
  }

  async connect(): Promise<void> {
    const creds = await this.deps.getCredentials();
    const ws = new this.WS(creds.socket);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.send('auth', [creds.token]);
      this.deps.onEvent({ type: 'open' });
    };
    ws.onmessage = (event: MessageEvent) =>
      void this.handleMessage(typeof event.data === 'string' ? event.data : '');
    ws.onclose = (event: CloseEvent) => this.handleClose(event.code);
    ws.onerror = () => this.deps.onEvent({ type: 'error', message: 'WebSocket error' });
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

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  private send(event: string, args: string[]): void {
    this.ws?.send(JSON.stringify({ event, args }));
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
      case 'token expired':
        await this.refreshToken();
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
    } catch {
      this.deps.onEvent({ type: 'error', message: 'Failed to refresh console token' });
    }
  }

  private handleClose(code: number): void {
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
