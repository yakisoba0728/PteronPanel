'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  listServersAction,
  setServerSuspendedAction,
  reinstallServerAction,
  deleteServerAction,
  renameServerAction,
  updateServerBuildAction,
  updateServerStartupAction,
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
    if (typed !== server.name) {
      setMsg('삭제 확인값이 서버 이름과 일치하지 않습니다.');
      return;
    }

    const res = await deleteServerAction(server.id, false);
    if (res.ok) {
      load();
    } else {
      setMsg(res.detail ?? '삭제 실패');
    }
  }

  function promptNumber(label: string, current: number): number | null {
    const value = prompt(label, String(current));
    if (value == null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setMsg(`${label} 값이 올바르지 않습니다.`);
      return null;
    }
    return Math.trunc(parsed);
  }

  async function updateBuild(server: PteroServer) {
    const memory = promptNumber('메모리(MB)', server.limits.memory);
    if (memory == null) return;
    const swap = promptNumber('Swap(MB)', server.limits.swap);
    if (swap == null) return;
    const disk = promptNumber('디스크(MB)', server.limits.disk);
    if (disk == null) return;
    const io = promptNumber('IO(10-1000)', server.limits.io);
    if (io == null) return;
    const cpu = promptNumber('CPU(%)', server.limits.cpu);
    if (cpu == null) return;
    const databases = promptNumber('DB 수', server.feature_limits.databases);
    if (databases == null) return;
    const allocations = promptNumber(
      '할당 수',
      server.feature_limits.allocations,
    );
    if (allocations == null) return;
    const backups = promptNumber('백업 수', server.feature_limits.backups);
    if (backups == null) return;

    const allocationRaw = prompt(
      '기본 allocation ID(변경하지 않으려면 비움)',
      server.allocation ? String(server.allocation) : '',
    );
    if (allocationRaw == null) return;
    const allocation = allocationRaw.trim()
      ? Number(allocationRaw.trim())
      : undefined;
    if (allocation !== undefined && !Number.isInteger(allocation)) {
      setMsg('기본 allocation ID가 올바르지 않습니다.');
      return;
    }

    const res = await updateServerBuildAction(server.id, {
      allocation,
      limits: { memory, swap, disk, io, cpu },
      featureLimits: { databases, allocations, backups },
    });
    if (res.ok) {
      load();
    } else {
      setMsg(res.detail ?? '빌드 설정 변경 실패');
    }
  }

  async function updateStartup(server: PteroServer) {
    const eggRaw = prompt('Egg ID', server.egg ? String(server.egg) : '');
    if (eggRaw == null) return;
    const egg = Number(eggRaw);
    if (!Number.isInteger(egg) || egg <= 0) {
      setMsg('Egg ID가 올바르지 않습니다.');
      return;
    }

    const image = prompt(
      'Docker 이미지',
      server.docker_image ?? 'ghcr.io/pterodactyl/yolks:java_17',
    );
    if (!image) return;
    const startup = prompt('시작 명령어', server.startup ?? '');
    if (!startup) return;
    const envRaw = prompt('환경변수 JSON', '{}');
    if (envRaw == null) return;

    let environment: Record<string, string>;
    try {
      const parsed = JSON.parse(envRaw) as unknown;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.values(parsed).some((value) => typeof value !== 'string')
      ) {
        throw new Error('environment must be a string map');
      }
      environment = parsed as Record<string, string>;
    } catch {
      setMsg('환경변수는 문자열 값만 가진 JSON 객체여야 합니다.');
      return;
    }

    const skipScripts = confirm('설치 스크립트를 건너뛰겠습니까?');
    const res = await updateServerStartupAction(server.id, {
      startup,
      egg,
      image,
      environment,
      skipScripts,
    });
    if (res.ok) {
      load();
    } else {
      setMsg(res.detail ?? '시작 설정 변경 실패');
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
                      onClick={() => updateBuild(server)}
                    >
                      빌드
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => updateStartup(server)}
                    >
                      시작
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
