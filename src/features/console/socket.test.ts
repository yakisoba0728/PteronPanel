import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSOLE_TOKEN_REFRESH_MS, ConsoleSocket, type ConsoleEvent } from './socket';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
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
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000 });
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
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

  it('queues log and stats requests until the socket is open', async () => {
    const { sock } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    sock.requestLogs();
    sock.requestStats();
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(ws.sent.map((raw) => JSON.parse(raw))).toEqual([
      { event: 'auth', args: ['tok-1'] },
      { event: 'send logs', args: [] },
      { event: 'send stats', args: [] },
    ]);
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

  it('refreshes the token proactively', async () => {
    vi.useFakeTimers();
    const { sock, getCredentials } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    getCredentials.mockResolvedValueOnce({
      token: 'tok-2',
      socket: 'wss://node/api/servers/uuid/ws',
    });
    await vi.advanceTimersByTimeAsync(CONSOLE_TOKEN_REFRESH_MS);
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ event: 'auth', args: ['tok-2'] });
    vi.useRealTimers();
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

  it('tears down the previous socket on reconnect so its late close cannot spawn a duplicate', async () => {
    vi.useFakeTimers();
    const { sock } = setup();
    await sock.connect();
    const first = FakeWebSocket.instances.at(-1)!;
    first.open();

    // Re-connect (e.g. token refresh / manual reconnect): a new socket is created.
    await sock.connect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances.at(-1)!;
    expect(second).not.toBe(first);

    // A late close arriving from the now-orphaned first socket must be ignored:
    // it must not schedule a reconnect (no third socket).
    first.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(20000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not reconnect after the user closes the socket', async () => {
    vi.useFakeTimers();
    const { sock } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();

    sock.close();
    await vi.advanceTimersByTimeAsync(20000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });

  it('reconnects with a NEW socket on "token expired" (no re-auth on the dead socket)', async () => {
    vi.useFakeTimers();
    const { sock } = setup();
    await sock.connect();
    const first = FakeWebSocket.instances.at(-1)!;
    first.open();
    const sentBeforeExpiry = first.sent.length;

    first.emit('token expired');
    // The dead socket must NOT receive another auth frame.
    expect(first.sent.length).toBe(sentBeforeExpiry);
    // The socket is closed and a reconnect establishes a brand-new socket.
    await vi.advanceTimersByTimeAsync(20000);
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    const reconnected = FakeWebSocket.instances.at(-1)!;
    expect(reconnected).not.toBe(first);
    reconnected.open();
    expect(JSON.parse(reconnected.sent[0])).toEqual({ event: 'auth', args: ['tok-1'] });
    vi.useRealTimers();
  });
});
