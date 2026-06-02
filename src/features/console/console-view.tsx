'use client';

import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getConsoleCredentials } from '@/server/console';
import type { AccessKind } from '@/lib/authz/visible-tabs';
import type { PowerSignal } from '@/lib/ptero/types';
import { consoleControls, type ConsoleControls } from './console-perms';
import { ConsoleSocket, type ConsoleStats } from './socket';

const powerActions: Array<{
  signal: PowerSignal;
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  control: keyof ConsoleControls;
}> = [
  { signal: 'start', label: '시작', variant: 'primary', control: 'canStart' },
  { signal: 'restart', label: '재시작', variant: 'secondary', control: 'canRestart' },
  { signal: 'stop', label: '정지', variant: 'secondary', control: 'canStop' },
  { signal: 'kill', label: '강제종료', variant: 'danger', control: 'canKill' },
];

// UI mitigation: subusers only see the power buttons / command input their
// permissions allow. This is NOT a real security boundary — a subuser with a
// websocket token can still drive Wings directly, so server-side enforcement
// (a console WS proxy) is tracked separately.
export function ConsoleView({
  identifier,
  accessKind,
  permissions,
}: {
  identifier: string;
  accessKind: AccessKind;
  permissions: string[];
}) {
  const controls = consoleControls(accessKind, permissions);
  const termRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<ConsoleSocket | null>(null);
  const termInstance = useRef<Terminal | null>(null);
  const [stats, setStats] = useState<ConsoleStats | null>(null);
  const [status, setStatus] = useState('connecting');
  const [command, setCommand] = useState('');

  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      theme: { background: '#09090b' },
    });
    const fit = new FitAddon();

    term.loadAddon(fit);

    if (termRef.current) {
      term.open(termRef.current);
      fit.fit();
    }

    termInstance.current = term;

    const sock = new ConsoleSocket({
      getCredentials: () => getConsoleCredentials(identifier),
      onEvent: (event) => {
        switch (event.type) {
          case 'console':
            term.writeln(event.line);
            break;
          case 'status':
            setStatus(event.status);
            break;
          case 'stats':
            setStats(event.stats);
            setStatus(event.stats.state);
            break;
          case 'error':
            term.writeln(`\x1b[31m[error] ${event.message}\x1b[0m`);
            break;
          case 'close':
            setStatus(event.suspended ? 'suspended' : 'disconnected');
            break;
          default:
            break;
        }
      },
    });

    socketRef.current = sock;
    void sock.connect().then(() => {
      sock.requestLogs();
      sock.requestStats();
    });

    const onResize = () => fit.fit();
    const statsTimer = window.setInterval(() => sock.requestStats(), 10_000);
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(statsTimer);
      window.removeEventListener('resize', onResize);
      sock.close();
      term.dispose();
      termInstance.current = null;
    };
  }, [identifier]);

  function submitCommand(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;
    socketRef.current?.sendCommand(trimmed);
    setCommand('');
  }

  function setPower(signal: PowerSignal) {
    socketRef.current?.setState(signal);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-zinc-500">상태:</span>
        <span>{status}</span>
        {stats ? (
          <span className="text-zinc-500">
            CPU {stats.cpu_absolute.toFixed(1)}% · RAM{' '}
            {(stats.memory_bytes / 1048576).toFixed(0)}MB · DISK{' '}
            {(stats.disk_bytes / 1048576).toFixed(0)}MB
          </span>
        ) : null}
      </div>

      <Card className="p-0">
        <div ref={termRef} className="h-[480px] w-full overflow-hidden rounded-lg" />
      </Card>

      <div className="flex flex-wrap gap-2">
        {powerActions
          .filter((action) => controls[action.control])
          .map((action) => (
            <Button
              key={action.signal}
              type="button"
              variant={action.variant}
              onClick={() => setPower(action.signal)}
            >
              {action.label}
            </Button>
          ))}
      </div>

      {controls.canCommand ? (
        <form onSubmit={submitCommand} className="flex gap-2">
          <Input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="콘솔 명령어 입력…"
          />
        </form>
      ) : null}
    </div>
  );
}
