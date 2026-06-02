'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import type { ActivityEntry } from '@/lib/ptero/types';
import { listActivityAction } from '@/server/activity';

export function ActivityView({ identifier }: { identifier: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await listActivityAction(identifier);
      if (res.ok) {
        setEntries(res.entries);
      } else {
        setMessage(
          res.error === 'not_found'
            ? '서버를 찾을 수 없습니다.'
            : (res.detail ?? '실패'),
        );
      }
    })();
  }, [identifier]);

  return (
    <div className="space-y-3">
      <h2 className="font-medium">활동 로그</h2>

      {message && <p className="text-sm text-red-600">{message}</p>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-2">{entry.event}</td>
                <td className="px-4 py-2 text-zinc-500">{entry.ip}</td>
                <td className="px-4 py-2 text-right text-zinc-400">
                  {new Date(entry.timestamp).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
