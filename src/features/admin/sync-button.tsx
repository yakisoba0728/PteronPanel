'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { syncServerAccessAction } from '@/server/admin/sync';

export function SyncButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const res = await syncServerAccessAction();
      setMessage(
        res.ok
          ? `동기화 완료: 서버 ${res.servers}개, 서브유저 링크 ${res.subuserLinks}개`
          : res.error === 'forbidden'
            ? '권한 없음'
            : (res.detail ?? '동기화 실패'),
      );
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={run} disabled={pending}>
        {pending ? '동기화 중...' : '서브유저 접근 동기화'}
      </Button>
      {message && <p className="text-sm text-zinc-500">{message}</p>}
      <p className="text-xs text-zinc-400">
        전 서버를 순회해 서브유저 접근 캐시를 갱신합니다. 서버가 많으면 시간이
        걸릴 수 있습니다.
      </p>
    </div>
  );
}
