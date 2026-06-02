'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  listNestsAction,
  listEggsAction,
  getEggAction,
  createServerAction,
} from '@/server/admin/servers';
import { listLocationsAction } from '@/server/admin/infra';
import {
  listPteronUsersAction,
  type PteronUserRow,
} from '@/server/admin/users';
import type {
  PteroNest,
  PteroEgg,
  PteroLocation,
  PteroEggVariable,
} from '@/lib/ptero/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function CreateWizard() {
  const router = useRouter();
  const [nests, setNests] = useState<PteroNest[]>([]);
  const [eggs, setEggs] = useState<PteroEgg[]>([]);
  const [locations, setLocations] = useState<PteroLocation[]>([]);
  const [users, setUsers] = useState<PteronUserRow[]>([]);
  const [variables, setVariables] = useState<PteroEggVariable[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [eggLoading, setEggLoading] = useState(false);
  const [loadedEgg, setLoadedEgg] = useState<{
    nestId: number;
    eggId: number;
  } | null>(null);
  const eggListRequest = useRef(0);
  const eggDetailRequest = useRef(0);

  const [form, setForm] = useState({
    name: '',
    user: 0,
    nest: 0,
    egg: 0,
    dockerImage: '',
    startup: '',
    memory: 1024,
    disk: 5120,
    cpu: 100,
    swap: 0,
    databases: 1,
    allocations: 1,
    backups: 1,
    locationId: 0,
    portRange: '25565-25570',
    startOnCompletion: true,
  });
  const [env, setEnv] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const [nestsRes, locationsRes, usersRes] = await Promise.all([
        listNestsAction(),
        listLocationsAction(),
        listPteronUsersAction(),
      ]);
      if (nestsRes.ok) setNests(nestsRes.nests);
      if (locationsRes.ok) setLocations(locationsRes.locations);
      if (usersRes.ok) {
        setUsers(usersRes.users.filter((user) => user.pteroUserId != null));
      }
    })();
  }, []);

  async function onNest(nestId: number) {
    eggListRequest.current += 1;
    eggDetailRequest.current += 1;
    setMsg(null);
    setForm((current) => ({
      ...current,
      nest: nestId,
      egg: 0,
      dockerImage: '',
      startup: '',
    }));
    setEggs([]);
    setVariables([]);
    setEnv({});
    setLoadedEgg(null);
    setEggLoading(false);
    if (!nestId) return;

    const requestId = eggListRequest.current;
    const res = await listEggsAction(nestId);
    if (requestId !== eggListRequest.current) return;
    if (res.ok) {
      setEggs(res.eggs);
    } else {
      setMsg(res.detail ?? 'Egg 목록을 불러오지 못했습니다.');
    }
  }

  async function onEgg(nestId: number, eggId: number) {
    eggDetailRequest.current += 1;
    setMsg(null);
    setLoadedEgg(null);
    setVariables([]);
    setEnv({});
    setForm((current) => ({
      ...current,
      egg: eggId,
      dockerImage: '',
      startup: '',
    }));
    if (!eggId) return;

    const requestId = eggDetailRequest.current;
    setEggLoading(true);
    const res = await getEggAction(nestId, eggId);
    if (requestId !== eggDetailRequest.current) return;
    setEggLoading(false);
    if (res.ok) {
      setForm((current) => ({
        ...current,
        dockerImage: res.egg.docker_image,
        startup: res.egg.startup,
      }));
      const eggVariables = res.egg.variables ?? [];
      setVariables(eggVariables);
      setEnv(
        Object.fromEntries(
          eggVariables.map((variable) => [
            variable.env_variable,
            variable.default_value,
          ]),
        ),
      );
      setLoadedEgg({ nestId, eggId });
    } else {
      setMsg(res.detail ?? 'Egg 정보를 불러오지 못했습니다.');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const eggReady =
      loadedEgg?.nestId === form.nest &&
      loadedEgg?.eggId === form.egg &&
      !eggLoading;
    if (!eggReady) {
      setMsg('선택한 Egg 정보를 불러온 뒤 생성할 수 있습니다.');
      return;
    }
    const missingRequired = variables
      .filter((variable) => variable.rules.split('|').includes('required'))
      .filter((variable) => !env[variable.env_variable]?.trim())
      .map((variable) => variable.name);
    if (missingRequired.length > 0) {
      setMsg(`필수 환경변수를 입력하세요: ${missingRequired.join(', ')}`);
      return;
    }
    setBusy(true);
    const res = await createServerAction({
      name: form.name,
      user: Number(form.user),
      egg: Number(form.egg),
      dockerImage: form.dockerImage,
      startup: form.startup,
      environment: env,
      limits: {
        memory: form.memory,
        swap: form.swap,
        disk: form.disk,
        io: 500,
        cpu: form.cpu,
      },
      featureLimits: {
        databases: form.databases,
        allocations: form.allocations,
        backups: form.backups,
      },
      locationIds: [Number(form.locationId)],
      portRange: [form.portRange],
      startOnCompletion: form.startOnCompletion,
    });
    setBusy(false);
    if (res.ok) {
      router.push('/admin/servers');
    } else {
      setMsg(
        res.detail ??
          (res.error === 'validation' ? '입력값을 확인하세요.' : '생성 실패'),
      );
    }
  }

  const num = (value: string) => {
    const n = parseInt(value.replace(/[^0-9-]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold">서버 생성</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <Card className="space-y-2">
        <h2 className="font-medium">기본</h2>
        <Input
          placeholder="서버 이름"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          className="w-full rounded-md border px-2 py-2 text-sm dark:bg-zinc-900"
          value={form.user}
          onChange={(e) => setForm({ ...form, user: num(e.target.value) })}
        >
          <option value={0}>소유자 선택(매핑된 유저)</option>
          {users.map((user) => (
            <option key={user.id} value={user.pteroUserId ?? 0}>
              {user.email} (ptero#{user.pteroUserId})
            </option>
          ))}
        </select>
      </Card>

      <Card className="space-y-2">
        <h2 className="font-medium">Egg</h2>
        <select
          className="w-full rounded-md border px-2 py-2 text-sm dark:bg-zinc-900"
          value={form.nest}
          onChange={(e) => onNest(num(e.target.value))}
        >
          <option value={0}>Nest 선택</option>
          {nests.map((nest) => (
            <option key={nest.id} value={nest.id}>
              {nest.name}
            </option>
          ))}
        </select>
        <select
          className="w-full rounded-md border px-2 py-2 text-sm dark:bg-zinc-900"
          value={form.egg}
          onChange={(e) => onEgg(form.nest, num(e.target.value))}
          disabled={!form.nest}
        >
          <option value={0}>Egg 선택</option>
          {eggs.map((egg) => (
            <option key={egg.id} value={egg.id}>
              {egg.name}
            </option>
          ))}
        </select>
        {eggLoading && (
          <p className="text-xs text-zinc-500">Egg 정보를 불러오는 중...</p>
        )}
        {form.egg > 0 && (
          <>
            <Input
              placeholder="Docker 이미지"
              value={form.dockerImage}
              onChange={(e) =>
                setForm({ ...form, dockerImage: e.target.value })
              }
            />
            <Input
              placeholder="시작 명령어"
              value={form.startup}
              onChange={(e) => setForm({ ...form, startup: e.target.value })}
            />
          </>
        )}
      </Card>

      {variables.length > 0 && (
        <Card className="space-y-2">
          <h2 className="font-medium">환경변수</h2>
          {variables.map((variable) => (
            <label key={variable.env_variable} className="block text-sm">
              <span className="text-zinc-500">
                {variable.name} ({variable.env_variable})
              </span>
              <Input
                value={env[variable.env_variable] ?? ''}
                onChange={(e) =>
                  setEnv({
                    ...env,
                    [variable.env_variable]: e.target.value,
                  })
                }
              />
            </label>
          ))}
        </Card>
      )}

      <Card className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-sm">
          메모리(MB)
          <Input
            type="number"
            value={form.memory}
            onChange={(e) => setForm({ ...form, memory: num(e.target.value) })}
          />
        </label>
        <label className="text-sm">
          디스크(MB)
          <Input
            type="number"
            value={form.disk}
            onChange={(e) => setForm({ ...form, disk: num(e.target.value) })}
          />
        </label>
        <label className="text-sm">
          CPU(%)
          <Input
            type="number"
            value={form.cpu}
            onChange={(e) => setForm({ ...form, cpu: num(e.target.value) })}
          />
        </label>
        <label className="text-sm">
          Swap(MB)
          <Input
            type="number"
            value={form.swap}
            onChange={(e) => setForm({ ...form, swap: num(e.target.value) })}
          />
        </label>
        <label className="text-sm">
          DB 수
          <Input
            type="number"
            value={form.databases}
            onChange={(e) =>
              setForm({ ...form, databases: num(e.target.value) })
            }
          />
        </label>
        <label className="text-sm">
          할당 수
          <Input
            type="number"
            value={form.allocations}
            onChange={(e) =>
              setForm({ ...form, allocations: num(e.target.value) })
            }
          />
        </label>
        <label className="text-sm">
          백업 수
          <Input
            type="number"
            value={form.backups}
            onChange={(e) => setForm({ ...form, backups: num(e.target.value) })}
          />
        </label>
      </Card>

      <Card className="space-y-2">
        <h2 className="font-medium">배포</h2>
        <select
          className="w-full rounded-md border px-2 py-2 text-sm dark:bg-zinc-900"
          value={form.locationId}
          onChange={(e) =>
            setForm({ ...form, locationId: num(e.target.value) })
          }
        >
          <option value={0}>로케이션 선택</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.short} {location.long ? `(${location.long})` : ''}
            </option>
          ))}
        </select>
        <Input
          placeholder="포트 범위 (예: 25565-25570)"
          value={form.portRange}
          onChange={(e) => setForm({ ...form, portRange: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.startOnCompletion}
            onChange={(e) =>
              setForm({ ...form, startOnCompletion: e.target.checked })
            }
          />
          설치 후 자동 시작
        </label>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          type="button"
          onClick={() => router.push('/admin/servers')}
        >
          취소
        </Button>
        <Button
          type="submit"
          disabled={
            busy ||
            !form.user ||
            !form.egg ||
            !form.locationId ||
            loadedEgg?.nestId !== form.nest ||
            loadedEgg?.eggId !== form.egg ||
            eggLoading
          }
        >
          {busy ? '생성 중...' : '서버 생성'}
        </Button>
      </div>
    </form>
  );
}
