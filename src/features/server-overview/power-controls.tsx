'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { PowerSignal } from '@/lib/ptero/types';
import { powerServerAction } from '@/server/servers';

const actions: Array<{
  signal: PowerSignal;
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
}> = [
  { signal: 'start', label: '시작', variant: 'primary' },
  { signal: 'restart', label: '재시작', variant: 'secondary' },
  { signal: 'stop', label: '정지', variant: 'secondary' },
  { signal: 'kill', label: '강제종료', variant: 'danger' },
];

export function PowerControls({ identifier }: { identifier: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(signal: PowerSignal) {
    setMessage(null);

    startTransition(async () => {
      const result = await powerServerAction(identifier, signal);
      if (!result.ok) {
        if (result.error === 'not_found') {
          setMessage('서버를 찾을 수 없습니다.');
        } else if (result.error === 'conflict') {
          setMessage(
            result.detail
              ? `현재 작업할 수 없는 상태입니다. (${result.detail})`
              : '현재 작업할 수 없는 상태입니다.',
          );
        } else {
          setMessage('작업에 실패했습니다.');
        }
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.signal}
            type="button"
            variant={action.variant}
            disabled={pending}
            onClick={() => run(action.signal)}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </div>
  );
}
