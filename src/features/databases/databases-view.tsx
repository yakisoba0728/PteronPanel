'use client';

import type { FormEvent } from 'react';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ServerDatabase } from '@/lib/ptero/types';
import {
  createDatabaseAction,
  deleteDatabaseAction,
  listDatabasesAction,
  rotateDatabasePasswordAction,
} from '@/server/databases';

export function DatabasesView({ identifier }: { identifier: string }) {
  const [databases, setDatabases] = useState<ServerDatabase[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const res = await listDatabasesAction(identifier);
      if (res.ok) {
        setDatabases(res.databases);
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

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const res = await createDatabaseAction(identifier, name, '%');
    if (res.ok) {
      setName('');
      load();
    } else {
      setMessage(res.detail ?? '생성 실패');
    }
  }

  async function rotate(database: ServerDatabase) {
    const res = await rotateDatabasePasswordAction(identifier, database.id);
    if (res.ok) load();
    else setMessage(res.detail ?? '실패');
  }

  async function remove(database: ServerDatabase) {
    if (!confirm(`${database.name} 삭제?`)) return;

    const res = await deleteDatabaseAction(identifier, database.id);
    if (res.ok) load();
    else setMessage(res.detail ?? '실패');
  }

  return (
    <div className="space-y-3">
      <h2 className="font-medium">데이터베이스</h2>

      {message && <p className="text-sm text-red-600">{message}</p>}

      <Card>
        <form onSubmit={create} className="flex gap-2">
          <Input
            placeholder="DB 이름"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit">생성</Button>
        </form>
      </Card>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-4 py-2">이름</th>
              <th className="px-4 py-2">호스트</th>
              <th className="px-4 py-2">유저</th>
              <th className="px-4 py-2">비밀번호</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {databases.map((database) => (
              <tr
                key={database.id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-2">{database.name}</td>
                <td className="px-4 py-2 text-zinc-500">
                  {database.host.address}:{database.host.port}
                </td>
                <td className="px-4 py-2">{database.username}</td>
                <td className="px-4 py-2">
                  <code className="text-xs">{database.password ?? '••••'}</code>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => rotate(database)}
                    >
                      비번회전
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => remove(database)}
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
