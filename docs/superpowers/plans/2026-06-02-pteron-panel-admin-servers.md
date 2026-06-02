# Pteron Panel — Admin: Server Provisioning & Lifecycle 구현 계획 (Phase 3b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 서버를 **생성(마법사)** 하고 **관리(정지/해제·재설치·삭제·상세/빌드/Startup 수정)** 할 수 있게 한다. 생성은 Egg 선택 → 소유자/노드(로케이션) → 리소스 → 환경변수 → 생성 흐름. Application API의 `POST /servers`(deploy 방식)를 사용.

**Architecture:** Plan 3a의 관리자 셸/가드 위에 얹는다. Application API 서버 래퍼는 `src/lib/ptero/application.ts`에 추가, 관리자 서버 액션은 `requireAdmin` 가드(`src/server/admin/servers.ts`). 생성은 **deploy 방식**(locations + port_range로 Panel이 할당 자동 배정)을 기본으로 하여 수동 allocation 선택 복잡도를 피한다. Egg 변수로 환경변수 폼을 구성.

**Tech Stack:** 기존 스택. **선행:** Phase 3a 완료 — `requireAdmin`/`assertAdmin`, application `listNests/listEggs/getEgg/listLocations`, admin 셸(`/admin` 레이아웃), `Ok/Fail` 액션 패턴. 참조 spec: 부록 A §2(servers create/update/suspend/delete), §A.7(생성 바디), §4, §15.

> **표준 규칙:** 각 Task commit + push(작업 브랜치). **AI 워터마크 금지.** **워크트리**에서 작업.

---

## File Structure (Phase 3b 범위)

| 파일 | 책임 |
|---|---|
| `src/lib/ptero/types.ts`(수정) | `PteroServer`, `CreateServerInput` |
| `src/lib/ptero/application.ts`(수정) | 서버 create/list/get/update/suspend/unsuspend/reinstall/delete |
| `src/server/admin/servers.ts` | 관리자 서버 액션(requireAdmin) + Egg/Nest 선택 보조 액션 |
| `src/app/(panel)/admin/servers/page.tsx` + `src/features/admin/servers/servers-table.tsx` | 관리자 서버 목록·관리 |
| `src/app/(panel)/admin/servers/new/page.tsx` + `src/features/admin/servers/create-wizard.tsx` | 서버 생성 마법사 |
| `e2e/admin-servers.spec.ts` | 생성 흐름 e2e |

---

## Task 1: Application API — 서버 래퍼 [TDD]

**Files:**
- Modify: `src/lib/ptero/types.ts`, `src/lib/ptero/application.ts`
- Create: `src/lib/ptero/application.servers.test.ts`

- [ ] **Step 1: 타입 추가**

`src/lib/ptero/types.ts` 끝에:
```ts
export interface PteroServer {
  id: number;
  uuid: string;
  identifier: string;
  name: string;
  user: number;
  node: number;
  suspended: boolean;
  limits: { memory: number; swap: number; disk: number; io: number; cpu: number };
  feature_limits: { databases: number; allocations: number; backups: number };
}

export interface CreateServerInput {
  name: string;
  user: number;
  egg: number;
  docker_image: string;
  startup: string;
  environment: Record<string, string>;
  limits: { memory: number; swap: number; disk: number; io: number; cpu: number };
  feature_limits: { databases: number; allocations: number; backups: number };
  deploy?: { locations: number[]; dedicated_ip: boolean; port_range: string[] };
  allocation?: { default: number; additional?: number[] };
  start_on_completion?: boolean;
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/ptero/application.servers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listAllServers, createServer, suspendServer, unsuspendServer, deleteServer, updateServerDetails } from './application';

const BASE = 'https://panel.test/api/application';
const srv = (over = {}) => ({ id: 1, uuid: 'suuid', identifier: '1a2b3c4d', name: 'srv', user: 7, node: 1, suspended: false, limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 }, feature_limits: { databases: 1, allocations: 1, backups: 1 }, ...over });

describe('application servers', () => {
  it('listAllServers paginates', async () => {
    mswServer.use(http.get(`${BASE}/servers`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: srv() }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
    expect((await listAllServers())[0]).toMatchObject({ id: 1, name: 'srv' });
  });

  it('createServer posts the full body (deploy)', async () => {
    let body: any;
    mswServer.use(http.post(`${BASE}/servers`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'server', attributes: srv({ id: 9 }) }); }));
    const s = await createServer({ name: 'New', user: 7, egg: 5, docker_image: 'img', startup: 'java', environment: { V: 'latest' }, limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 }, feature_limits: { databases: 1, allocations: 1, backups: 1 }, deploy: { locations: [1], dedicated_ip: false, port_range: ['25565-25570'] }, start_on_completion: true });
    expect(body).toMatchObject({ name: 'New', user: 7, egg: 5, deploy: { locations: [1] }, start_on_completion: true });
    expect(s.id).toBe(9);
  });

  it('suspend / unsuspend / delete', async () => {
    let suspended = false, unsuspended = false, deleted = false;
    mswServer.use(
      http.post(`${BASE}/servers/9/suspend`, () => { suspended = true; return new HttpResponse(null, { status: 204 }); }),
      http.post(`${BASE}/servers/9/unsuspend`, () => { unsuspended = true; return new HttpResponse(null, { status: 204 }); }),
      http.delete(`${BASE}/servers/9`, () => { deleted = true; return new HttpResponse(null, { status: 204 }); }),
    );
    await suspendServer(9); await unsuspendServer(9); await deleteServer(9);
    expect([suspended, unsuspended, deleted]).toEqual([true, true, true]);
  });

  it('updateServerDetails PATCHes details', async () => {
    let body: any;
    mswServer.use(http.patch(`${BASE}/servers/9/details`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'server', attributes: srv({ id: 9, name: 'Renamed' }) }); }));
    const s = await updateServerDetails(9, { name: 'Renamed' });
    expect(body).toEqual({ name: 'Renamed' });
    expect(s.name).toBe('Renamed');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run src/lib/ptero/application.servers.test.ts`
Expected: FAIL.

- [ ] **Step 4: 구현 추가**

`src/lib/ptero/application.ts`에 추가:
```ts
export async function listAllServers(): Promise<PteroServer[]> {
  const items = await paginateAll<PteroServer>((page) => pteroFetch('application', '/servers', { query: { page, per_page: 100 } }));
  return items.map((i) => i.attributes);
}
export async function getServerAdmin(id: number): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>('application', `/servers/${id}`);
  return res.attributes;
}
export async function createServer(input: CreateServerInput): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>('application', '/servers', { method: 'POST', body: input });
  return res.attributes;
}
export async function updateServerDetails(id: number, input: { name?: string; user?: number; external_id?: string; description?: string }): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>('application', `/servers/${id}/details`, { method: 'PATCH', body: input });
  return res.attributes;
}
export async function updateServerBuild(id: number, input: { limits?: Partial<CreateServerInput['limits']>; feature_limits?: Partial<CreateServerInput['feature_limits']>; allocation?: number }): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>('application', `/servers/${id}/build`, { method: 'PATCH', body: input });
  return res.attributes;
}
export async function updateServerStartup(id: number, input: { startup?: string; egg?: number; image?: string; environment?: Record<string, string>; skip_scripts?: boolean }): Promise<PteroServer> {
  const res = await pteroFetch<PteroItem<PteroServer>>('application', `/servers/${id}/startup`, { method: 'PATCH', body: input });
  return res.attributes;
}
export async function suspendServer(id: number): Promise<void> { await pteroFetch('application', `/servers/${id}/suspend`, { method: 'POST' }); }
export async function unsuspendServer(id: number): Promise<void> { await pteroFetch('application', `/servers/${id}/unsuspend`, { method: 'POST' }); }
export async function reinstallServer(id: number): Promise<void> { await pteroFetch('application', `/servers/${id}/reinstall`, { method: 'POST' }); }
export async function deleteServer(id: number, force = false): Promise<void> { await pteroFetch('application', `/servers/${id}${force ? '/force' : ''}`, { method: 'DELETE' }); }
```

- [ ] **Step 5: 통과 + Commit + Push**

```bash
git add src/lib/ptero/types.ts src/lib/ptero/application.ts src/lib/ptero/application.servers.test.ts
git commit -m "feat(ptero): application server create/list/update/suspend/delete wrappers"
git push
```

---

## Task 2: 관리자 서버 액션 + Egg 선택 보조 액션 [TDD]

**Files:**
- Create: `src/server/admin/servers.ts`, `src/server/admin/servers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/server/admin/servers.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

let currentUser: any = { id: 'admin', role: 'ADMIN', pteroUserId: null };
vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => currentUser) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { listServersAction, createServerAction } from './servers';

const BASE = 'https://panel.test/api/application';
beforeEach(() => { currentUser = { id: 'admin', role: 'ADMIN', pteroUserId: null }; });

describe('admin server actions', () => {
  it('non-admin rejected', async () => {
    currentUser = { id: 'u', role: 'USER', pteroUserId: 1 };
    expect(await listServersAction()).toEqual({ ok: false, error: 'forbidden' });
  });

  it('createServerAction validates and posts', async () => {
    let body: any;
    mswServer.use(http.post(`${BASE}/servers`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'server', attributes: { id: 9, uuid: 'u', identifier: '1a2b3c4d', name: 'New', user: 7, node: 1, suspended: false, limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 }, feature_limits: { databases: 1, allocations: 1, backups: 1 } } }); }));
    const res = await createServerAction({
      name: 'New', user: 7, egg: 5, dockerImage: 'img', startup: 'java',
      environment: { V: 'latest' },
      limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 },
      featureLimits: { databases: 1, allocations: 1, backups: 1 },
      locationIds: [1], portRange: ['25565-25570'], startOnCompletion: true,
    });
    expect(res.ok).toBe(true);
    expect(body).toMatchObject({ name: 'New', user: 7, egg: 5, deploy: { locations: [1], port_range: ['25565-25570'] } });
  });

  it('createServerAction rejects invalid input', async () => {
    const res = await createServerAction({ name: '', user: 0 } as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('validation');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/server/admin/servers.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`src/server/admin/servers.ts`:
```ts
'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/current-user';
import { assertAdmin, AdminRequiredError } from '@/lib/authz/admin';
import * as app from '@/lib/ptero/application';
import type { PteroServer, PteroNest, PteroEgg } from '@/lib/ptero/types';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';

type Fail = { ok: false; error: 'forbidden' | 'failed' | 'validation'; detail?: string };
type Ok<T> = { ok: true } & T;

async function admin() { const u = await requireUser(); assertAdmin(u); return u; }
function fail(err: unknown): Fail {
  if (err instanceof AdminRequiredError) return { ok: false, error: 'forbidden' };
  if (err instanceof z.ZodError) return { ok: false, error: 'validation', detail: err.issues[0]?.message };
  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('admin server action failed', err);
  return { ok: false, error: 'failed', detail };
}

export async function listServersAction(): Promise<Ok<{ servers: PteroServer[] }> | Fail> {
  try { await admin(); return { ok: true, servers: await app.listAllServers() }; } catch (err) { return fail(err); }
}

// --- wizard helpers ---
export async function listNestsAction(): Promise<Ok<{ nests: PteroNest[] }> | Fail> {
  try { await admin(); return { ok: true, nests: await app.listNests() }; } catch (err) { return fail(err); }
}
export async function listEggsAction(nestId: number): Promise<Ok<{ eggs: PteroEgg[] }> | Fail> {
  try { await admin(); return { ok: true, eggs: await app.listEggs(nestId) }; } catch (err) { return fail(err); }
}
export async function getEggAction(nestId: number, eggId: number): Promise<Ok<{ egg: PteroEgg }> | Fail> {
  try { await admin(); return { ok: true, egg: await app.getEgg(nestId, eggId) }; } catch (err) { return fail(err); }
}

const CreateSchema = z.object({
  name: z.string().min(1).max(191),
  user: z.number().int().positive(),
  egg: z.number().int().positive(),
  dockerImage: z.string().min(1),
  startup: z.string().min(1),
  environment: z.record(z.string()),
  limits: z.object({ memory: z.number().int().min(0), swap: z.number().int().min(-1), disk: z.number().int().min(0), io: z.number().int().min(10).max(1000), cpu: z.number().int().min(0) }),
  featureLimits: z.object({ databases: z.number().int().min(0), allocations: z.number().int().min(0), backups: z.number().int().min(0) }),
  locationIds: z.array(z.number().int().positive()).min(1),
  portRange: z.array(z.string()).min(1),
  startOnCompletion: z.boolean().optional(),
});

export async function createServerAction(input: z.infer<typeof CreateSchema>): Promise<Ok<{ id: number }> | Fail> {
  try {
    const me = await admin();
    const d = CreateSchema.parse(input);
    const server = await app.createServer({
      name: d.name, user: d.user, egg: d.egg, docker_image: d.dockerImage, startup: d.startup,
      environment: d.environment, limits: d.limits, feature_limits: d.featureLimits,
      deploy: { locations: d.locationIds, dedicated_ip: false, port_range: d.portRange },
      start_on_completion: d.startOnCompletion ?? false,
    });
    await audit('admin.server.create', { userId: me.id, target: String(server.id), metadata: { name: d.name, egg: d.egg } });
    return { ok: true, id: server.id };
  } catch (err) { return fail(err); }
}

export async function setServerSuspendedAction(id: number, suspended: boolean): Promise<Ok<{}> | Fail> {
  try {
    const me = await admin();
    if (suspended) await app.suspendServer(id); else await app.unsuspendServer(id);
    await audit(suspended ? 'admin.server.suspend' : 'admin.server.unsuspend', { userId: me.id, target: String(id) });
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function reinstallServerAction(id: number): Promise<Ok<{}> | Fail> {
  try { const me = await admin(); await app.reinstallServer(id); await audit('admin.server.reinstall', { userId: me.id, target: String(id) }); return { ok: true }; }
  catch (err) { return fail(err); }
}

export async function deleteServerAction(id: number, force = false): Promise<Ok<{}> | Fail> {
  try { const me = await admin(); await app.deleteServer(id, force); await audit('admin.server.delete', { userId: me.id, target: String(id), metadata: { force } }); return { ok: true }; }
  catch (err) { return fail(err); }
}

export async function renameServerAction(id: number, name: string): Promise<Ok<{}> | Fail> {
  try { const me = await admin(); await app.updateServerDetails(id, { name }); await audit('admin.server.rename', { userId: me.id, target: String(id) }); return { ok: true }; }
  catch (err) { return fail(err); }
}
```

- [ ] **Step 4: 통과 + Commit + Push**

```bash
git add src/server/admin/servers.ts src/server/admin/servers.test.ts
git commit -m "feat(admin): server actions (list/create-wizard helpers/suspend/reinstall/delete/rename)"
git push
```

---

## Task 3: 서버 생성 마법사 UI

**Files:**
- Create: `src/features/admin/servers/create-wizard.tsx`, `src/app/(panel)/admin/servers/new/page.tsx`

- [ ] **Step 1: 마법사(Client) 작성**

`src/features/admin/servers/create-wizard.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listNestsAction, listEggsAction, getEggAction, createServerAction } from '@/server/admin/servers';
import { listLocationsAction } from '@/server/admin/infra';
import { listPteronUsersAction, type PteronUserRow } from '@/server/admin/users';
import type { PteroNest, PteroEgg, PteroLocation, PteroEggVariable } from '@/lib/ptero/types';
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

  const [form, setForm] = useState({
    name: '', user: 0, nest: 0, egg: 0, dockerImage: '', startup: '',
    memory: 1024, disk: 5120, cpu: 100, swap: 0,
    databases: 1, allocations: 1, backups: 1,
    locationId: 0, portRange: '25565-25570', startOnCompletion: true,
  });
  const [env, setEnv] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const [n, l, u] = await Promise.all([listNestsAction(), listLocationsAction(), listPteronUsersAction()]);
      if (n.ok) setNests(n.nests);
      if (l.ok) setLocations(l.locations);
      if (u.ok) setUsers(u.users.filter((x) => x.pteroUserId != null));
    })();
  }, []);

  async function onNest(nestId: number) {
    setForm((f) => ({ ...f, nest: nestId, egg: 0 }));
    setEggs([]); setVariables([]);
    if (!nestId) return;
    const r = await listEggsAction(nestId);
    if (r.ok) setEggs(r.eggs);
  }
  async function onEgg(eggId: number) {
    setForm((f) => ({ ...f, egg: eggId }));
    if (!eggId) return;
    const r = await getEggAction(form.nest, eggId);
    if (r.ok) {
      setForm((f) => ({ ...f, dockerImage: r.egg.docker_image, startup: r.egg.startup }));
      const vars = r.egg.variables ?? [];
      setVariables(vars);
      setEnv(Object.fromEntries(vars.map((v) => [v.env_variable, v.default_value])));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setBusy(true);
    const res = await createServerAction({
      name: form.name, user: Number(form.user), egg: Number(form.egg),
      dockerImage: form.dockerImage, startup: form.startup, environment: env,
      limits: { memory: form.memory, swap: form.swap, disk: form.disk, io: 500, cpu: form.cpu },
      featureLimits: { databases: form.databases, allocations: form.allocations, backups: form.backups },
      locationIds: [Number(form.locationId)], portRange: [form.portRange],
      startOnCompletion: form.startOnCompletion,
    });
    setBusy(false);
    if (res.ok) router.push('/admin/servers');
    else setMsg(res.detail ?? (res.error === 'validation' ? '입력값을 확인하세요.' : '생성 실패'));
  }

  const num = (v: string) => Number(v.replace(/[^0-9-]/g, '') || 0);

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold">서버 생성</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <Card className="space-y-2">
        <h2 className="font-medium">기본</h2>
        <Input placeholder="서버 이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className="w-full rounded-md border px-2 py-2 text-sm dark:bg-zinc-900" value={form.user} onChange={(e) => setForm({ ...form, user: num(e.target.value) })}>
          <option value={0}>소유자 선택(매핑된 유저)</option>
          {users.map((u) => <option key={u.id} value={u.pteroUserId ?? 0}>{u.email} (ptero#{u.pteroUserId})</option>)}
        </select>
      </Card>

      <Card className="space-y-2">
        <h2 className="font-medium">Egg</h2>
        <select className="w-full rounded-md border px-2 py-2 text-sm dark:bg-zinc-900" value={form.nest} onChange={(e) => onNest(num(e.target.value))}>
          <option value={0}>Nest 선택</option>
          {nests.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <select className="w-full rounded-md border px-2 py-2 text-sm dark:bg-zinc-900" value={form.egg} onChange={(e) => onEgg(num(e.target.value))} disabled={!form.nest}>
          <option value={0}>Egg 선택</option>
          {eggs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        {form.egg > 0 && (
          <>
            <Input placeholder="Docker 이미지" value={form.dockerImage} onChange={(e) => setForm({ ...form, dockerImage: e.target.value })} />
            <Input placeholder="시작 명령어" value={form.startup} onChange={(e) => setForm({ ...form, startup: e.target.value })} />
          </>
        )}
      </Card>

      {variables.length > 0 && (
        <Card className="space-y-2">
          <h2 className="font-medium">환경변수</h2>
          {variables.map((v) => (
            <label key={v.env_variable} className="block text-sm">
              <span className="text-zinc-500">{v.name} ({v.env_variable})</span>
              <Input value={env[v.env_variable] ?? ''} onChange={(e) => setEnv({ ...env, [v.env_variable]: e.target.value })} />
            </label>
          ))}
        </Card>
      )}

      <Card className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-sm">메모리(MB)<Input type="number" value={form.memory} onChange={(e) => setForm({ ...form, memory: num(e.target.value) })} /></label>
        <label className="text-sm">디스크(MB)<Input type="number" value={form.disk} onChange={(e) => setForm({ ...form, disk: num(e.target.value) })} /></label>
        <label className="text-sm">CPU(%)<Input type="number" value={form.cpu} onChange={(e) => setForm({ ...form, cpu: num(e.target.value) })} /></label>
        <label className="text-sm">Swap(MB)<Input type="number" value={form.swap} onChange={(e) => setForm({ ...form, swap: num(e.target.value) })} /></label>
        <label className="text-sm">DB 수<Input type="number" value={form.databases} onChange={(e) => setForm({ ...form, databases: num(e.target.value) })} /></label>
        <label className="text-sm">할당 수<Input type="number" value={form.allocations} onChange={(e) => setForm({ ...form, allocations: num(e.target.value) })} /></label>
        <label className="text-sm">백업 수<Input type="number" value={form.backups} onChange={(e) => setForm({ ...form, backups: num(e.target.value) })} /></label>
      </Card>

      <Card className="space-y-2">
        <h2 className="font-medium">배포</h2>
        <select className="w-full rounded-md border px-2 py-2 text-sm dark:bg-zinc-900" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: num(e.target.value) })}>
          <option value={0}>로케이션 선택</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.short} {l.long ? `(${l.long})` : ''}</option>)}
        </select>
        <Input placeholder="포트 범위 (예: 25565-25570)" value={form.portRange} onChange={(e) => setForm({ ...form, portRange: e.target.value })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.startOnCompletion} onChange={(e) => setForm({ ...form, startOnCompletion: e.target.checked })} />설치 후 자동 시작</label>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={() => router.push('/admin/servers')}>취소</Button>
        <Button type="submit" disabled={busy || !form.user || !form.egg || !form.locationId}>{busy ? '생성 중…' : '서버 생성'}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: 페이지 작성**

`src/app/(panel)/admin/servers/new/page.tsx`:
```tsx
import { CreateWizard } from '@/features/admin/servers/create-wizard';
export default function NewServerPage() { return <CreateWizard />; }
```

- [ ] **Step 3: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add src/features/admin/servers/create-wizard.tsx "src/app/(panel)/admin/servers/new/page.tsx"
git commit -m "feat(admin): server creation wizard (egg/owner/resources/env/deploy)"
git push
```

---

## Task 4: 관리자 서버 목록 · 관리 UI

**Files:**
- Create: `src/features/admin/servers/servers-table.tsx`, `src/app/(panel)/admin/servers/page.tsx`

- [ ] **Step 1: 서버 테이블(Client) 작성**

`src/features/admin/servers/servers-table.tsx`:
```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { listServersAction, setServerSuspendedAction, reinstallServerAction, deleteServerAction, renameServerAction } from '@/server/admin/servers';
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
      if (res.ok) setServers(res.servers);
      else setMsg(res.error === 'forbidden' ? '권한 없음' : (res.detail ?? '불러오기 실패'));
    });
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function toggleSuspend(s: PteroServer) {
    const res = await setServerSuspendedAction(s.id, !s.suspended);
    if (res.ok) load(); else setMsg(res.detail ?? '실패');
  }
  async function reinstall(s: PteroServer) {
    if (!confirm(`${s.name} 재설치할까요?`)) return;
    const res = await reinstallServerAction(s.id);
    setMsg(res.ok ? '재설치를 시작했습니다.' : (res.detail ?? '실패'));
  }
  async function remove(s: PteroServer) {
    const typed = prompt(`삭제하려면 서버 이름을 입력하세요: ${s.name}`);
    if (typed !== s.name) return;
    const res = await deleteServerAction(s.id, false);
    if (res.ok) load(); else setMsg(res.detail ?? '삭제 실패');
  }
  async function rename(s: PteroServer) {
    const name = prompt('새 이름', s.name);
    if (!name || name === s.name) return;
    const res = await renameServerAction(s.id, name);
    if (res.ok) load(); else setMsg(res.detail ?? '이름 변경 실패');
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">서버</h1>
        <Link href="/admin/servers/new"><Button>서버 생성</Button></Link>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card className="p-0">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500"><th className="px-4 py-2">이름</th><th className="px-4 py-2">소유자</th><th className="px-4 py-2">노드</th><th className="px-4 py-2">상태</th><th /></tr></thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2">{s.name}<div className="text-xs text-zinc-400">{s.identifier}</div></td>
                <td className="px-4 py-2 text-zinc-500">#{s.user}</td>
                <td className="px-4 py-2 text-zinc-500">#{s.node}</td>
                <td className="px-4 py-2">{s.suspended ? '정지됨' : '활성'}</td>
                <td className="px-4 py-2"><div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => rename(s)}>이름</Button>
                  <Button variant="ghost" onClick={() => toggleSuspend(s)}>{s.suspended ? '해제' : '정지'}</Button>
                  <Button variant="ghost" onClick={() => reinstall(s)}>재설치</Button>
                  <Button variant="ghost" onClick={() => remove(s)}>삭제</Button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {pending && <p className="text-xs text-zinc-400">불러오는 중…</p>}
    </div>
  );
}
```

- [ ] **Step 2: 페이지 작성**

`src/app/(panel)/admin/servers/page.tsx`:
```tsx
import { ServersTable } from '@/features/admin/servers/servers-table';
export default function AdminServersPage() { return <ServersTable />; }
```

- [ ] **Step 3: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add src/features/admin/servers/servers-table.tsx "src/app/(panel)/admin/servers/page.tsx"
git commit -m "feat(admin): server list + manage (suspend/reinstall/delete/rename)"
git push
```

---

## Task 5: e2e (서버 생성 흐름) + 최종 검증

**Files:**
- Modify: `e2e/mock-panel.mjs` (nests/eggs/servers create 엔드포인트)
- Create: `e2e/admin-servers.spec.ts`

- [ ] **Step 1: mock 패널 확장**

`e2e/mock-panel.mjs`에 추가:
```js
if (p === '/api/application/nests') {
  return json({ object: 'list', data: [{ object: 'nest', attributes: { id: 1, name: 'Minecraft', description: null } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } });
}
if (p === '/api/application/nests/1/eggs') {
  return json({ object: 'list', data: [{ object: 'egg', attributes: { id: 5, name: 'Paper', docker_image: 'ghcr.io/pterodactyl/yolks:java_17', startup: 'java -jar server.jar' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } });
}
if (p === '/api/application/nests/1/eggs/5') {
  return json({ object: 'egg', attributes: { id: 5, name: 'Paper', docker_image: 'ghcr.io/pterodactyl/yolks:java_17', startup: 'java -jar server.jar', relationships: { variables: { object: 'list', data: [{ object: 'egg_variable', attributes: { name: 'Version', description: '', env_variable: 'MC_VERSION', default_value: 'latest', rules: 'required|string', user_editable: true } }] } } } });
}
if (p === '/api/application/servers' && req.method === 'POST') {
  return json({ object: 'server', attributes: { id: 99, uuid: 'new-uuid', identifier: 'newserv', name: 'E2E Server', user: 7, node: 1, suspended: false, limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 }, feature_limits: { databases: 1, allocations: 1, backups: 1 } } });
}
if (p === '/api/application/servers') { // GET list
  return json({ object: 'list', data: [{ object: 'server', attributes: { id: 12, uuid: 'u', identifier: '1a2b3c4d', name: 'User Server', user: 7, node: 1, suspended: false, limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 }, feature_limits: { databases: 1, allocations: 1, backups: 1 } } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } });
}
```
> `req.method` 분기를 위해 mock 핸들러 상단에서 `const method = req.method;`로 접근.

- [ ] **Step 2: e2e 스펙 작성**

`e2e/admin-servers.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

async function login(page, id: string, pw: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="password"]', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

test('admin sees server list', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin/servers');
  await expect(page.getByText('User Server')).toBeVisible();
});

test('admin can open the create wizard and see egg options', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin/servers/new');
  await expect(page.getByText('서버 생성')).toBeVisible();
  await expect(page.getByText('Nest 선택')).toBeVisible();
});
```

- [ ] **Step 3: 전체 검증**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
```
Expected: 전부 그린(application.servers + admin.servers 단위 테스트 + admin-servers e2e).

- [ ] **Step 4: README 갱신 + Commit + Push**

`README.md` 기능 목록에 "관리자: 유저·노드·로케이션 관리, 서버 생성/관리" 반영.
```bash
git add e2e/ README.md
git commit -m "test(e2e): admin server list + create wizard; README update"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지:** 부록 A §2/§A.7 서버 create(deploy 방식)·list·details/build/startup 수정·suspend/unsuspend·reinstall·delete(+force) ✓T1,2 · §4 인가(모든 액션 `assertAdmin`) ✓T2 · §15 audit(create/suspend/reinstall/delete/rename) ✓T2 · Egg 변수→환경변수 폼 ✓T3.
- **보안:** 모든 관리자 서버 액션 `admin()` 선행. 키 서버 전용(application.ts). 삭제는 이름 타이핑 확인(UI).
- **플레이스홀더 스캔:** 모든 코드/명령 실측.
- **타입 일관성:** `CreateServerInput`(types)↔`createServer`(wrapper)↔`CreateSchema`(action) 필드 정합; 액션의 camelCase 입력(dockerImage/featureLimits/locationIds/portRange)을 wrapper의 snake_case 바디로 매핑. `Ok/Fail` 패턴 일관. `PteroServer/PteroNest/PteroEgg/PteroLocation`·`listLocationsAction`(3a)·`listPteronUsersAction`(3a) 재사용.
- **deploy 방식 선택:** 수동 allocation UI 생략(복잡도↓), Panel 자동 배정. 수동 allocation은 후속 강화로.
- **환경 의존:** 단위(MSW + mock, 패널·DB 불필요) / e2e(mock 패널 + 시드 DB).

---

## Phase 3 완료 후
Phase 4(나머지 클라이언트 + **서브유저**: DB·스케줄·네트워크·Startup·설정·활동로그 — 서브유저 스코프는 `ServerAccess` 캐시 테이블 도입) → Phase 5(마감·강화) → Phase 6(플러그인 시스템). 각 Phase는 자체 plan 추가.
