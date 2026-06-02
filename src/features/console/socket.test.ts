import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleSocket, type ConsoleEvent } from './socket';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.({ code: 1000 });
  }

  open() {
    this.onopen?.();
  }

  emit(event: string, args: string[] = []) {
    this.onmessage?.({ data: JSON.stringify({ event, args }) });
  }
}

function setup(creds = { token: 'tok-1', socket: 'wss://node/api/servers/uuid/ws' }) {
  const events: ConsoleEvent[] = [];
  const getCredentials = vi.fn().mockResolvedValue(creds);
  const sock = new ConsoleSocket({
    getCredentials,
    onEvent: (event) => events.push(event),
    WebSocketImpl: FakeWebSocket as unknown as { new (url: string): WebSocket },
  });
  return { sock, events, getCredentials };
}

describe('ConsoleSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useRealTimers();
  });

  it('authenticates with the token on open', async () => {
    const { sock } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    expect(JSON.parse(ws.sent[0])).toEqual({ event: 'auth', args: ['tok-1'] });
  });

  it('emits console + stats events', async () => {
    const { sock, events } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.emit('console output', ['hello']);
    ws.emit(
      'stats',
      [
        JSON.stringify({
          memory_bytes: 5,
          cpu_absolute: 1,
          disk_bytes: 9,
          network: { rx_bytes: 1, tx_bytes: 2 },
          uptime: 10,
          state: 'running',
        }),
      ],
    );
    expect(events).toContainEqual({ type: 'console', line: 'hello' });
    expect(events.find((event) => event.type === 'stats')).toMatchObject({
      type: 'stats',
      stats: { memory_bytes: 5, state: 'running' },
    });
  });

  it('refreshes the token on "token expiring"', async () => {
    const { sock, getCredentials } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    getCredentials.mockResolvedValueOnce({
      token: 'tok-2',
      socket: 'wss://node/api/servers/uuid/ws',
    });
    ws.emit('token expiring');
    await vi.waitFor(() => {
      expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ event: 'auth', args: ['tok-2'] });
    });
  });

  it('sends commands and power signals', async () => {
    const { sock } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    sock.sendCommand('say hi');
    sock.setState('restart');
    expect(JSON.parse(ws.sent.at(-2)!)).toEqual({
      event: 'send command',
      args: ['say hi'],
    });
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      event: 'set state',
      args: ['restart'],
    });
  });

  it('does not reconnect after a 4409 (suspended) close', async () => {
    vi.useFakeTimers();
    const { sock, events } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.onclose?.({ code: 4409 });
    vi.advanceTimersByTime(20000);
    expect(events).toContainEqual({ type: 'close', code: 4409, suspended: true });
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });
});
