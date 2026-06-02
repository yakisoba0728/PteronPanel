'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  listServersAction,
  setServerSuspendedAction,
  reinstallServerAction,
  deleteServerAction,
  renameServerAction,
} from '@/server/admin/servers';
import type { PteroServer } from '@/lib/ptero/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function ServersTable() {
  const [servers, setServers] = useState<PteroServer[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const res = await listServersAction();
      if (res.ok) {
        setServers(res.servers);
      } else {
        setMsg(
          res.error === 'forbidden'
            ? '권한 없음'
            : (res.detail ?? '불러오기 실패'),
        );
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleSuspend(server: PteroServer) {
    const res = await setServerSuspendedAction(server.id, !server.suspended);
    if (res.ok) {
      load();
    } else {
      setMsg(res.detail ?? '실패');
    }
  }

  async function reinstall(server: PteroServer) {
    if (!confirm(`${server.name} 재설치할까요?`)) return;
    const res = await reinstallServerAction(server.id);
    setMsg(res.ok ? '재설치를 시작했습니다.' : (res.detail ?? '실패'));
  }

  async function remove(server: PteroServer) {
    const typed = prompt(`삭제하려면 서버 이름을 입력하세요: ${server.name}`);
    if (typed !== server.name) return;

    const res = await deleteServerAction(server.id, false);
    if (res.ok) {
      load();
    } else {
      setMsg(res.detail ?? '삭제 실패');
    }
  }

  async function rename(server: PteroServer) {
    const name = prompt('새 이름', server.name);
    if (!name || name === server.name) return;

    const res = await renameServerAction(server.id, name);
    if (res.ok) {
      load();
    } else {
      setMsg(res.detail ?? '이름 변경 실패');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">서버</h1>
        <Link href="/admin/servers/new">
          <Button>서버 생성</Button>
        </Link>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-4 py-2">이름</th>
              <th className="px-4 py-2">소유자</th>
              <th className="px-4 py-2">노드</th>
              <th className="px-4 py-2">상태</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => (
              <tr
                key={server.id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-2">
                  {server.name}
                  <div className="text-xs text-zinc-400">
                    {server.identifier}
                  </div>
                </td>
                <td className="px-4 py-2 text-zinc-500">#{server.user}</td>
                <td className="px-4 py-2 text-zinc-500">#{server.node}</td>
                <td className="px-4 py-2">
                  {server.suspended ? '정지됨' : '활성'}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => rename(server)}>
                      이름
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => toggleSuspend(server)}
                    >
                      {server.suspended ? '해제' : '정지'}
                    </Button>
                    <Button variant="ghost" onClick={() => reinstall(server)}>
                      재설치
                    </Button>
                    <Button variant="ghost" onClick={() => remove(server)}>
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
