'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import type { PteroNode } from '@/lib/ptero/types';
import { listNodesAction } from '@/server/admin/infra';

export function NodesView() {
  const [nodes, setNodes] = useState<PteroNode[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const res = await listNodesAction();
      if (res.ok) {
        setNodes(res.nodes);
      } else {
        setMsg(res.detail ?? '불러오기 실패');
      }
    }

    load();
  }, []);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">노드</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-4 py-2">이름</th>
              <th className="px-4 py-2">FQDN</th>
              <th className="px-4 py-2">메모리</th>
              <th className="px-4 py-2">디스크</th>
              <th className="px-4 py-2">점검</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr
                key={node.id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-2">{node.name}</td>
                <td className="px-4 py-2 text-zinc-500">{node.fqdn}</td>
                <td className="px-4 py-2">{node.memory} MB</td>
                <td className="px-4 py-2">{node.disk} MB</td>
                <td className="px-4 py-2">
                  {node.maintenance_mode ? '점검중' : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
