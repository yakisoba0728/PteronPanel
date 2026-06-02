'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  listDeliveriesAction,
  retryDeliveryAction,
  type DeliveryRow,
} from '@/server/plugins';

export function Deliveries({ pluginId }: { pluginId: string }) {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const result = await listDeliveriesAction(pluginId);
    if (result.ok) {
      setRows(result.deliveries);
      setMsg(null);
    } else {
      setMsg('실패');
    }
  }

  useEffect(() => {
    void load();
  }, [pluginId]);

  async function retry(id: string) {
    const result = await retryDeliveryAction(pluginId, id);
    if (result.ok) void load();
    else setMsg('재시도 실패');
  }

  return (
    <div className="space-y-2 text-xs">
      {msg && <p className="text-red-600">{msg}</p>}
      {rows.length === 0 && <p className="text-zinc-400">전송 기록 없음</p>}
      {rows.map((delivery) => (
        <div
          key={delivery.id}
          className="flex items-center justify-between gap-3 rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-800"
        >
          <span className="min-w-0 truncate">
            {delivery.event} · {delivery.status}
            {delivery.responseCode ? ` (${delivery.responseCode})` : ''} ·{' '}
            {new Date(delivery.createdAt).toLocaleString()}
          </span>
          {delivery.status === 'failed' && (
            <Button variant="ghost" onClick={() => retry(delivery.id)}>
              재시도
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
