'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Subuser } from '@/lib/ptero/types';
import {
  createSubuserAction,
  deleteSubuserAction,
  getPermissionsAction,
  listSubusersAction,
  updateSubuserAction,
} from '@/server/subusers';

export function SubusersView({ identifier }: { identifier: string }) {
  const [subusers, setSubusers] = useState<Subuser[]>([]);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    new Set(['control.console']),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const [subusersRes, permissionsRes] = await Promise.all([
        listSubusersAction(identifier),
        getPermissionsAction(identifier),
      ]);

      if (subusersRes.ok) {
        setSubusers(subusersRes.subusers);
      } else {
        setMessage(
          subusersRes.error === 'not_found'
            ? '서버를 찾을 수 없습니다.'
            : (subusersRes.detail ?? '불러오기 실패'),
        );
      }

      if (permissionsRes.ok) {
        setPermissionKeys(permissionsRes.keys);
      }
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier]);

  function toggleSelected(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await createSubuserAction(identifier, email, [...selected]);
    if (res.ok) {
      setEmail('');
      load();
    } else {
      setMessage(
        res.detail ??
          (res.error === 'validation' ? '이메일/권한을 확인하세요.' : '초대 실패'),
      );
    }
  }

  async function remove(subuser: Subuser) {
    if (!confirm(`${subuser.email} 제거?`)) return;
    const res = await deleteSubuserAction(identifier, subuser.uuid);
    if (res.ok) load();
    else setMessage(res.detail ?? '제거 실패');
  }

  async function togglePermission(subuser: Subuser, key: string) {
    const next = subuser.permissions.includes(key)
      ? subuser.permissions.filter((permission) => permission !== key)
      : [...subuser.permissions, key];
    const res = await updateSubuserAction(identifier, subuser.uuid, next);
    if (res.ok) load();
    else setMessage(res.detail ?? '권한 변경 실패');
  }

  return (
    <div className="space-y-3">
      <h2 className="font-medium">서브유저</h2>
      {message && <p className="text-sm text-red-600">{message}</p>}

      <Card className="space-y-3">
        <h3 className="text-sm font-medium">초대</h3>
        <form onSubmit={create} className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="이메일"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit">초대</Button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {permissionKeys.map((key) => (
              <label key={key} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggleSelected(key)}
                />
                {key}
              </label>
            ))}
          </div>
        </form>
      </Card>

      {subusers.map((subuser) => (
        <Card key={subuser.uuid} className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{subuser.email}</p>
              <p className="text-xs text-zinc-500">{subuser.username}</p>
            </div>
            <Button type="button" variant="ghost" onClick={() => remove(subuser)}>
              제거
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {permissionKeys.map((key) => (
              <label key={key} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={subuser.permissions.includes(key)}
                  onChange={() => togglePermission(subuser, key)}
                />
                {key}
              </label>
            ))}
          </div>
        </Card>
      ))}

      {pending && <p className="text-xs text-zinc-400">불러오는 중...</p>}
    </div>
  );
}
