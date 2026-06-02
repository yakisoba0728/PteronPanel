'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ServerAllocation } from '@/lib/ptero/types';
import {
  assignAllocationAction,
  deleteAllocationAction,
  listAllocationsAction,
  setAllocationNoteAction,
  setPrimaryAllocationAction,
} from '@/server/network';

export function NetworkView({ identifier }: { identifier: string }) {
  const [allocations, setAllocations] = useState<ServerAllocation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const res = await listAllocationsAction(identifier);
      if (res.ok) {
        setAllocations(res.allocations);
      } else {
        setMessage(
          res.error === 'not_found'
            ? '서버를 찾을 수 없습니다.'
            : (res.detail ?? '실패'),
        );
      }
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier]);

  async function assign() {
    const res = await assignAllocationAction(identifier);
    if (res.ok) load();
    else setMessage(res.detail ?? '할당 실패');
  }

  async function primary(allocation: ServerAllocation) {
    const res = await setPrimaryAllocationAction(identifier, allocation.id);
    if (res.ok) load();
    else setMessage(res.detail ?? '실패');
  }

  async function note(allocation: ServerAllocation) {
    const notes = prompt('메모', allocation.notes ?? '');
    if (notes === null) return;

    const res = await setAllocationNoteAction(identifier, allocation.id, notes);
    if (res.ok) load();
    else setMessage(res.detail ?? '실패');
  }

  async function remove(allocation: ServerAllocation) {
    if (allocation.is_default) {
      setMessage('기본 할당은 삭제할 수 없습니다.');
      return;
    }
    if (!confirm('삭제?')) return;

    const res = await deleteAllocationAction(identifier, allocation.id);
    if (res.ok) load();
    else setMessage(res.detail ?? '실패');
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">네트워크</h2>
        <Button type="button" onClick={assign}>
          할당 추가
        </Button>
      </div>

      {message && <p className="text-sm text-red-600">{message}</p>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <tbody>
            {allocations.map((allocation) => (
              <tr
                key={allocation.id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-2">
                  {allocation.ip_alias ?? allocation.ip}:{allocation.port}{' '}
                  {allocation.is_default && (
                    <span className="text-xs text-indigo-500">(기본)</span>
                  )}
                </td>
                <td className="px-4 py-2 text-zinc-500">
                  {allocation.notes}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    {!allocation.is_default && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => primary(allocation)}
                      >
                        기본설정
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => note(allocation)}
                    >
                      메모
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => remove(allocation)}
                    >
                      삭제
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {pending && <p className="text-xs text-zinc-400">불러오는 중...</p>}
    </div>
  );
}
