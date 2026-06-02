'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { PteroLocation } from '@/lib/ptero/types';
import {
  createLocationAction,
  deleteLocationAction,
  listLocationsAction,
} from '@/server/admin/infra';

export function LocationsManager() {
  const [locations, setLocations] = useState<PteroLocation[]>([]);
  const [form, setForm] = useState({ short: '', long: '' });
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await listLocationsAction();
    if (res.ok) {
      setLocations(res.locations);
    } else {
      setMsg(res.detail ?? '불러오기 실패');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);

    const res = await createLocationAction({
      short: form.short,
      long: form.long || undefined,
    });
    if (res.ok) {
      setForm({ short: '', long: '' });
      load();
    } else {
      setMsg(res.detail ?? '생성 실패');
    }
  }

  async function remove(location: PteroLocation) {
    const typed = prompt(`삭제하려면 ${location.short} 을(를) 입력하세요.`);
    if (typed !== location.short) {
      setMsg('삭제 확인값이 일치하지 않습니다.');
      return;
    }

    const res = await deleteLocationAction(location.id);
    if (res.ok) {
      load();
    } else {
      setMsg(res.detail ?? '삭제 실패');
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">로케이션</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card>
        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="short (예: kr)"
            value={form.short}
            onChange={(event) =>
              setForm({ ...form, short: event.target.value })
            }
          />
          <Input
            placeholder="long (설명)"
            value={form.long}
            onChange={(event) =>
              setForm({ ...form, long: event.target.value })
            }
          />
          <Button type="submit">추가</Button>
        </form>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <tbody>
            {locations.map((location) => (
              <tr
                key={location.id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-2 font-medium">{location.short}</td>
                <td className="px-4 py-2 text-zinc-500">{location.long}</td>
                <td className="px-4 py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => remove(location)}
                  >
                    삭제
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
