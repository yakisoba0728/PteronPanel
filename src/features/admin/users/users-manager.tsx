'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  createPteronUserAction,
  deletePteronUserAction,
  listPteronUsersAction,
  type PteronUserRow,
  updatePteronUserAction,
} from '@/server/admin/users';

export function UsersManager() {
  const [users, setUsers] = useState<PteronUserRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    email: '',
    username: '',
    password: '',
    role: 'USER',
    createPterodactyl: false,
  });

  function load() {
    start(async () => {
      const res = await listPteronUsersAction();
      if (res.ok) {
        setUsers(res.users);
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

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);

    const res = await createPteronUserAction({
      ...form,
      role: form.role as 'ADMIN' | 'USER',
    });
    if (res.ok) {
      setForm({
        email: '',
        username: '',
        password: '',
        role: 'USER',
        createPterodactyl: false,
      });
      load();
    } else {
      setMsg(res.detail ?? (res.error === 'validation' ? '입력값 확인' : '생성 실패'));
    }
  }

  async function toggleActive(user: PteronUserRow) {
    const res = await updatePteronUserAction({
      id: user.id,
      isActive: !user.isActive,
    });
    if (res.ok) {
      load();
    } else {
      setMsg(res.detail ?? '수정 실패');
    }
  }

  async function remove(user: PteronUserRow) {
    const typed = prompt(`삭제하려면 ${user.email} 을(를) 입력하세요.`);
    if (typed !== user.email) {
      setMsg('삭제 확인값이 일치하지 않습니다.');
      return;
    }

    const res = await deletePteronUserAction(user.id);
    if (res.ok) {
      load();
    } else {
      setMsg(res.detail ?? '삭제 실패');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">유저 관리</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <Card>
        <h2 className="mb-2 font-medium">새 Pteron 계정</h2>
        <form onSubmit={create} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Input
            placeholder="이메일"
            value={form.email}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
          />
          <Input
            placeholder="아이디"
            value={form.username}
            onChange={(event) =>
              setForm({ ...form, username: event.target.value })
            }
          />
          <Input
            placeholder="비밀번호(8+)"
            type="password"
            value={form.password}
            onChange={(event) =>
              setForm({ ...form, password: event.target.value })
            }
          />
          <select
            className="rounded-md border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={form.role}
            onChange={(event) =>
              setForm({ ...form, role: event.target.value })
            }
          >
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <Button type="submit" disabled={pending}>
            생성
          </Button>
          <label className="col-span-2 flex items-center gap-2 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={form.createPterodactyl}
              onChange={(event) =>
                setForm({
                  ...form,
                  createPterodactyl: event.target.checked,
                })
              }
            />
            매핑되는 Pterodactyl 유저가 없으면 새로 생성
          </label>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="px-4 py-2">이메일</th>
              <th className="px-4 py-2">아이디</th>
              <th className="px-4 py-2">역할</th>
              <th className="px-4 py-2">매핑</th>
              <th className="px-4 py-2">활성</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-2">{user.email}</td>
                <td className="px-4 py-2">{user.username}</td>
                <td className="px-4 py-2">{user.role}</td>
                <td className="px-4 py-2 text-zinc-500">
                  {user.pteroUserId ?? '미매핑'}
                </td>
                <td className="px-4 py-2">{user.isActive ? '✓' : '✗'}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => toggleActive(user)}
                    >
                      {user.isActive ? '비활성' : '활성'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => remove(user)}
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
