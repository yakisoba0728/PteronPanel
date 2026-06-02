# Pteron Panel — Server Detail Features 구현 계획 (Phase 4a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 뷰에 남은 클라이언트 기능 탭을 추가한다 — **데이터베이스**(목록·생성·비번회전·삭제), **네트워크/할당**(목록·할당·메모·기본설정·삭제), **Startup/변수**(변수 조회·수정), **설정**(rename·reinstall·docker-image), **활동 로그**(목록). 서브유저와 스케줄은 별도 계획(4c/4b).

**Architecture:** files/backups와 동일 패턴 — Client API 래퍼(`src/lib/ptero/client.ts`) → 가드된 Server Action(`src/server/*`, requireUser→requireServerAccess) → 서버 뷰 탭(`src/registry/server-tabs.ts`에 추가). 키 비노출, 비소유 404.

**Tech Stack:** 기존 스택. **선행:** Phase 1·2 완료 — `pteroFetch`, `requireServerAccess`, `asIdentifier`, `Ok/Fail` 액션 패턴, `serverTabs`, UI 컴포넌트. 참조 spec: 부록 A §3.5(DB)·§3.7(Network)·§3.9(Startup)·§3.10(Settings)·§3.1(activity), §4 인가.

> **표준 규칙:** 각 Task commit + push(작업 브랜치). **AI 워터마크 금지.** **워크트리**에서 작업.

---

## File Structure (Phase 4a 범위)

| 파일 | 책임 |
|---|---|
| `src/lib/ptero/types.ts`(수정) | `ServerDatabase`, `ServerAllocation`, `StartupVariable`, `ActivityEntry` |
| `src/lib/ptero/client.ts`(수정) | DB/네트워크/Startup/설정/활동 래퍼 |
| `src/server/databases.ts`, `src/server/network.ts`, `src/server/startup.ts`, `src/server/settings.ts`, `src/server/activity.ts` | 가드된 액션 |
| `src/registry/server-tabs.ts`(수정) | databases/network/startup/settings/activity 탭 |
| `src/app/(panel)/servers/[id]/{databases,network,startup,settings,activity}/page.tsx` | 페이지 |
| `src/features/{databases,network,startup,settings,activity}/*` | UI |
| `e2e/*`(수정) | mock 확장 + e2e |

---

## Task 1: DB 클라이언트 래퍼 + 타입 [TDD]

**Files:**
- Modify: `src/lib/ptero/types.ts`, `src/lib/ptero/client.ts`
- Create: `src/lib/ptero/client.databases.test.ts`

- [ ] **Step 1: 타입 추가**

`src/lib/ptero/types.ts` 끝에:
```ts
export interface ServerDatabase {
  id: string;            // client hashid
  name: string;
  username: string;
  host: { address: string; port: number };
  connections_from: string;
  max_connections: number;
  password?: string;     // present with include=password / after rotate
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/ptero/client.databases.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listDatabases, createDatabase, rotateDatabasePassword, deleteDatabase } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');
const dbObj = (over = {}) => ({ object: 'server_database', attributes: { id: 'HASH1', name: 's1_db', username: 'u_db', host: { address: '10.0.0.1', port: 3306 }, connections_from: '%', max_connections: 0, relationships: { password: { object: 'database_password', attributes: { password: 'secret' } } }, ...over } });

describe('client databases', () => {
  it('listDatabases maps + extracts password', async () => {
    mswServer.use(http.get(`${BASE}/servers/1a2b3c4d/databases`, ({ request }) => { expect(new URL(request.url).searchParams.get('include')).toBe('password'); return HttpResponse.json({ object: 'list', data: [dbObj()] }); }));
    const dbs = await listDatabases(id);
    expect(dbs[0]).toMatchObject({ id: 'HASH1', name: 's1_db', host: { address: '10.0.0.1', port: 3306 }, password: 'secret' });
  });
  it('createDatabase posts {database, remote}', async () => {
    let body: any;
    mswServer.use(http.post(`${BASE}/servers/1a2b3c4d/databases`, async ({ request }) => { body = await request.json(); return HttpResponse.json(dbObj({ id: 'HASH2' })); }));
    const db = await createDatabase(id, { database: 'mydb', remote: '%' });
    expect(body).toEqual({ database: 'mydb', remote: '%' });
    expect(db.id).toBe('HASH2');
  });
  it('rotateDatabasePassword returns new password', async () => {
    mswServer.use(http.post(`${BASE}/servers/1a2b3c4d/databases/HASH1/rotate-password`, () => HttpResponse.json(dbObj({ relationships: { password: { object: 'database_password', attributes: { password: 'newsecret' } } } }))));
    expect((await rotateDatabasePassword(id, 'HASH1')).password).toBe('newsecret');
  });
  it('deleteDatabase DELETEs', async () => {
    let called = false;
    mswServer.use(http.delete(`${BASE}/servers/1a2b3c4d/databases/HASH1`, () => { called = true; return new HttpResponse(null, { status: 204 }); }));
    await deleteDatabase(id, 'HASH1');
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인 → 구현**

Run: `pnpm vitest run src/lib/ptero/client.databases.test.ts` → FAIL.

`src/lib/ptero/client.ts`에 추가:
```ts
interface DbAttrs {
  id: string; name: string; username: string;
  host: { address: string; port: number };
  connections_from: string; max_connections: number;
  relationships?: { password?: { attributes: { password: string } } };
}
function mapDb(a: DbAttrs): ServerDatabase {
  return { id: a.id, name: a.name, username: a.username, host: a.host, connections_from: a.connections_from, max_connections: a.max_connections, password: a.relationships?.password?.attributes.password };
}
export async function listDatabases(id: ServerIdentifier): Promise<ServerDatabase[]> {
  const res = await pteroFetch<PteroList<DbAttrs>>('client', `/servers/${id}/databases`, { query: { include: 'password' } });
  return res.data.map((d) => mapDb(d.attributes));
}
export async function createDatabase(id: ServerIdentifier, input: { database: string; remote: string }): Promise<ServerDatabase> {
  const res = await pteroFetch<PteroItem<DbAttrs>>('client', `/servers/${id}/databases`, { method: 'POST', body: input });
  return mapDb(res.attributes);
}
export async function rotateDatabasePassword(id: ServerIdentifier, dbId: string): Promise<ServerDatabase> {
  const res = await pteroFetch<PteroItem<DbAttrs>>('client', `/servers/${id}/databases/${dbId}/rotate-password`, { method: 'POST' });
  return mapDb(res.attributes);
}
export async function deleteDatabase(id: ServerIdentifier, dbId: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/databases/${dbId}`, { method: 'DELETE' });
}
```
(상단 import에 `ServerDatabase` 타입 추가.)

Run: `pnpm vitest run src/lib/ptero/client.databases.test.ts` → 4 PASS.

- [ ] **Step 4: Commit + Push**

```bash
git add src/lib/ptero/types.ts src/lib/ptero/client.ts src/lib/ptero/client.databases.test.ts
git commit -m "feat(ptero): client database endpoints (list/create/rotate/delete)"
git push
```

---

## Task 2: 네트워크/할당 클라이언트 래퍼 + 타입 [TDD]

**Files:**
- Modify: `src/lib/ptero/types.ts`, `src/lib/ptero/client.ts`
- Create: `src/lib/ptero/client.network.test.ts`

- [ ] **Step 1: 타입 추가**

```ts
export interface ServerAllocation {
  id: number;
  ip: string;
  ip_alias: string | null;
  port: number;
  notes: string | null;
  is_default: boolean;
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/ptero/client.network.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listAllocations, assignAllocation, setAllocationNote, setPrimaryAllocation, deleteAllocation } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');
const alloc = (over = {}) => ({ object: 'allocation', attributes: { id: 1, ip: '0.0.0.0', ip_alias: null, port: 25565, notes: null, is_default: true, ...over } });

describe('client network', () => {
  it('listAllocations maps', async () => {
    mswServer.use(http.get(`${BASE}/servers/1a2b3c4d/network/allocations`, () => HttpResponse.json({ object: 'list', data: [alloc()] })));
    expect((await listAllocations(id))[0]).toMatchObject({ id: 1, port: 25565, is_default: true });
  });
  it('assignAllocation POSTs', async () => {
    mswServer.use(http.post(`${BASE}/servers/1a2b3c4d/network/allocations`, () => HttpResponse.json(alloc({ id: 2, port: 25566, is_default: false }))));
    expect((await assignAllocation(id)).id).toBe(2);
  });
  it('setAllocationNote POSTs {notes}', async () => {
    let body: any;
    mswServer.use(http.post(`${BASE}/servers/1a2b3c4d/network/allocations/2`, async ({ request }) => { body = await request.json(); return HttpResponse.json(alloc({ id: 2, notes: 'web' })); }));
    await setAllocationNote(id, 2, 'web');
    expect(body).toEqual({ notes: 'web' });
  });
  it('setPrimaryAllocation + deleteAllocation', async () => {
    let primary = false, deleted = false;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/network/allocations/2/primary`, () => { primary = true; return HttpResponse.json(alloc({ id: 2, is_default: true })); }),
      http.delete(`${BASE}/servers/1a2b3c4d/network/allocations/2`, () => { deleted = true; return new HttpResponse(null, { status: 204 }); }),
    );
    await setPrimaryAllocation(id, 2); await deleteAllocation(id, 2);
    expect([primary, deleted]).toEqual([true, true]);
  });
});
```

- [ ] **Step 3: 실패 확인 → 구현**

`src/lib/ptero/client.ts`에 추가:
```ts
export async function listAllocations(id: ServerIdentifier): Promise<ServerAllocation[]> {
  const res = await pteroFetch<PteroList<ServerAllocation>>('client', `/servers/${id}/network/allocations`);
  return res.data.map((d) => d.attributes);
}
export async function assignAllocation(id: ServerIdentifier): Promise<ServerAllocation> {
  const res = await pteroFetch<PteroItem<ServerAllocation>>('client', `/servers/${id}/network/allocations`, { method: 'POST' });
  return res.attributes;
}
export async function setAllocationNote(id: ServerIdentifier, allocId: number, notes: string): Promise<ServerAllocation> {
  const res = await pteroFetch<PteroItem<ServerAllocation>>('client', `/servers/${id}/network/allocations/${allocId}`, { method: 'POST', body: { notes } });
  return res.attributes;
}
export async function setPrimaryAllocation(id: ServerIdentifier, allocId: number): Promise<ServerAllocation> {
  const res = await pteroFetch<PteroItem<ServerAllocation>>('client', `/servers/${id}/network/allocations/${allocId}/primary`, { method: 'POST' });
  return res.attributes;
}
export async function deleteAllocation(id: ServerIdentifier, allocId: number): Promise<void> {
  await pteroFetch('client', `/servers/${id}/network/allocations/${allocId}`, { method: 'DELETE' });
}
```

Run: `pnpm vitest run src/lib/ptero/client.network.test.ts` → PASS.

- [ ] **Step 4: Commit + Push**

```bash
git add src/lib/ptero/types.ts src/lib/ptero/client.ts src/lib/ptero/client.network.test.ts
git commit -m "feat(ptero): client network/allocation endpoints"
git push
```

---

## Task 3: Startup·설정·활동 클라이언트 래퍼 + 타입 [TDD]

**Files:**
- Modify: `src/lib/ptero/types.ts`, `src/lib/ptero/client.ts`
- Create: `src/lib/ptero/client.misc.test.ts`

- [ ] **Step 1: 타입 추가**

```ts
export interface StartupVariable {
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  server_value: string;
  is_editable: boolean;
  rules: string;
}
export interface ActivityEntry {
  id: string;
  event: string;
  ip: string | null;
  description: string | null;
  timestamp: string;
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/ptero/client.misc.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { getStartupVariables, updateStartupVariable, renameServer, reinstallServer, setDockerImage, listActivity } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');

describe('client startup/settings/activity', () => {
  it('getStartupVariables maps', async () => {
    mswServer.use(http.get(`${BASE}/servers/1a2b3c4d/startup`, () => HttpResponse.json({ object: 'list', data: [{ object: 'egg_variable', attributes: { name: 'Version', description: '', env_variable: 'VERSION', default_value: 'latest', server_value: '1.20', is_editable: true, rules: 'required|string' } }], meta: { startup_command: 'java', raw_startup_command: 'java' } })));
    expect((await getStartupVariables(id))[0]).toMatchObject({ env_variable: 'VERSION', server_value: '1.20' });
  });
  it('updateStartupVariable PUTs {key,value}', async () => {
    let body: any;
    mswServer.use(http.put(`${BASE}/servers/1a2b3c4d/startup/variable`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'egg_variable', attributes: { name: 'V', description: '', env_variable: 'VERSION', default_value: 'latest', server_value: '1.21', is_editable: true, rules: '' } }); }));
    await updateStartupVariable(id, 'VERSION', '1.21');
    expect(body).toEqual({ key: 'VERSION', value: '1.21' });
  });
  it('renameServer/reinstallServer/setDockerImage', async () => {
    let renamed: any, reinstalled = false, image: any;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/settings/rename`, async ({ request }) => { renamed = await request.json(); return new HttpResponse(null, { status: 204 }); }),
      http.post(`${BASE}/servers/1a2b3c4d/settings/reinstall`, () => { reinstalled = true; return new HttpResponse(null, { status: 204 }); }),
      http.put(`${BASE}/servers/1a2b3c4d/settings/docker-image`, async ({ request }) => { image = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    await renameServer(id, 'New', 'desc'); await reinstallServer(id); await setDockerImage(id, 'img:2');
    expect(renamed).toEqual({ name: 'New', description: 'desc' });
    expect(reinstalled).toBe(true);
    expect(image).toEqual({ docker_image: 'img:2' });
  });
  it('listActivity maps', async () => {
    mswServer.use(http.get(`${BASE}/servers/1a2b3c4d/activity`, () => HttpResponse.json({ object: 'list', data: [{ object: 'activity_log', attributes: { id: 'a1', event: 'server:console.command', ip: '1.2.3.4', description: null, timestamp: '2026-01-01T00:00:00Z' } }], meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } } })));
    expect((await listActivity(id))[0]).toMatchObject({ id: 'a1', event: 'server:console.command' });
  });
});
```

> 참고: 클라이언트 settings 경로의 `renameServer`/`reinstallServer`는 Phase 1의 `client.power`/`getServer`와 다른 함수다. 기존 `client.ts`에 동명 함수가 없는지 확인하고, 충돌 시 `renameServerSettings`/`reinstallServerClient`로 명명한다(아래 액션도 그에 맞춰).

- [ ] **Step 3: 실패 확인 → 구현**

`src/lib/ptero/client.ts`에 추가:
```ts
export async function getStartupVariables(id: ServerIdentifier): Promise<StartupVariable[]> {
  const res = await pteroFetch<PteroList<StartupVariable>>('client', `/servers/${id}/startup`);
  return res.data.map((d) => d.attributes);
}
export async function updateStartupVariable(id: ServerIdentifier, key: string, value: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/startup/variable`, { method: 'PUT', body: { key, value } });
}
export async function renameServer(id: ServerIdentifier, name: string, description?: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/settings/rename`, { method: 'POST', body: { name, description } });
}
export async function reinstallServer(id: ServerIdentifier): Promise<void> {
  await pteroFetch('client', `/servers/${id}/settings/reinstall`, { method: 'POST' });
}
export async function setDockerImage(id: ServerIdentifier, dockerImage: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/settings/docker-image`, { method: 'PUT', body: { docker_image: dockerImage } });
}
export async function listActivity(id: ServerIdentifier): Promise<ActivityEntry[]> {
  const res = await pteroFetch<PteroList<ActivityEntry>>('client', `/servers/${id}/activity`, { query: { per_page: 50 } });
  return res.data.map((d) => d.attributes);
}
```

Run: `pnpm vitest run src/lib/ptero/client.misc.test.ts` → PASS.

- [ ] **Step 4: Commit + Push**

```bash
git add src/lib/ptero/types.ts src/lib/ptero/client.ts src/lib/ptero/client.misc.test.ts
git commit -m "feat(ptero): client startup/settings/activity endpoints"
git push
```

---

## Task 4: DB · 네트워크 Server Actions (가드) [TDD]

**Files:**
- Create: `src/server/databases.ts`, `src/server/network.ts`, `src/server/databases.test.ts`

> 기존 `src/server/files.ts`의 `guard()`+`toFail()` 패턴을 그대로 따른다(requireUser→asIdentifier→requireServerAccess; ServerAccessDeniedError→not_found).

- [ ] **Step 1: 실패 테스트 작성 (가드 검증)**

`src/server/databases.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null })) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { listDatabasesAction } from './databases';

const CLIENT = 'https://panel.test/api/client';
beforeEach(() => invalidateAccessCache());
function adminLists(idf: string) {
  mswServer.use(http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: { identifier: idf, uuid: `${idf}-0000-4000-8000-000000000000`, name: 'S' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
}

describe('listDatabasesAction', () => {
  it('returns databases for accessible server', async () => {
    adminLists('1a2b3c4d');
    mswServer.use(http.get(`${CLIENT}/servers/1a2b3c4d/databases`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server_database', attributes: { id: 'H1', name: 'db', username: 'u', host: { address: 'h', port: 3306 }, connections_from: '%', max_connections: 0 } }] })));
    const res = await listDatabasesAction('1a2b3c4d');
    expect(res.ok && res.databases[0].id).toBe('H1');
  });
  it('not_found for inaccessible', async () => {
    adminLists('1a2b3c4d');
    expect(await listDatabasesAction('deadbeef')).toEqual({ ok: false, error: 'not_found' });
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/server/databases.ts`:
```ts
'use server';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier, type ServerDatabase } from '@/lib/ptero/types';
import * as ptero from '@/lib/ptero/client';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser { return { id: u.id, role: u.role, pteroUserId: u.pteroUserId }; }
type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;
async function guard(identifier: string) { const user = await requireUser(); const id = asIdentifier(identifier); await requireServerAccess(scope(user), id); return { user, id }; }
function toFail(err: unknown): Fail { if (err instanceof ServerAccessDeniedError) return { ok: false, error: 'not_found' }; const detail = err instanceof PteroApiError ? err.primary?.detail : undefined; console.error('db action failed', err); return { ok: false, error: 'failed', detail }; }

export async function listDatabasesAction(identifier: string): Promise<Ok<{ databases: ServerDatabase[] }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, databases: await ptero.listDatabases(id) }; } catch (err) { return toFail(err); }
}
export async function createDatabaseAction(identifier: string, database: string, remote: string): Promise<Ok<{ database: ServerDatabase }> | Fail> {
  try { const { user, id } = await guard(identifier); const db = await ptero.createDatabase(id, { database, remote: remote || '%' }); await audit('database.create', { userId: user.id, target: id, metadata: { database } }); return { ok: true, database: db }; } catch (err) { return toFail(err); }
}
export async function rotateDatabasePasswordAction(identifier: string, dbId: string): Promise<Ok<{ database: ServerDatabase }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, database: await ptero.rotateDatabasePassword(id, dbId) }; } catch (err) { return toFail(err); }
}
export async function deleteDatabaseAction(identifier: string, dbId: string): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.deleteDatabase(id, dbId); await audit('database.delete', { userId: user.id, target: id, metadata: { dbId } }); return { ok: true }; } catch (err) { return toFail(err); }
}
```

`src/server/network.ts` (동일 패턴):
```ts
'use server';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier, type ServerAllocation } from '@/lib/ptero/types';
import * as ptero from '@/lib/ptero/client';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser { return { id: u.id, role: u.role, pteroUserId: u.pteroUserId }; }
type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;
async function guard(identifier: string) { const user = await requireUser(); const id = asIdentifier(identifier); await requireServerAccess(scope(user), id); return { user, id }; }
function toFail(err: unknown): Fail { if (err instanceof ServerAccessDeniedError) return { ok: false, error: 'not_found' }; const detail = err instanceof PteroApiError ? err.primary?.detail : undefined; console.error('network action failed', err); return { ok: false, error: 'failed', detail }; }

export async function listAllocationsAction(identifier: string): Promise<Ok<{ allocations: ServerAllocation[] }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, allocations: await ptero.listAllocations(id) }; } catch (err) { return toFail(err); }
}
export async function assignAllocationAction(identifier: string): Promise<Ok<{ allocation: ServerAllocation }> | Fail> {
  try { const { user, id } = await guard(identifier); const a = await ptero.assignAllocation(id); await audit('network.assign', { userId: user.id, target: id }); return { ok: true, allocation: a }; } catch (err) { return toFail(err); }
}
export async function setAllocationNoteAction(identifier: string, allocId: number, notes: string): Promise<Ok<{}> | Fail> {
  try { const { id } = await guard(identifier); await ptero.setAllocationNote(id, allocId, notes); return { ok: true }; } catch (err) { return toFail(err); }
}
export async function setPrimaryAllocationAction(identifier: string, allocId: number): Promise<Ok<{}> | Fail> {
  try { const { id } = await guard(identifier); await ptero.setPrimaryAllocation(id, allocId); return { ok: true }; } catch (err) { return toFail(err); }
}
export async function deleteAllocationAction(identifier: string, allocId: number): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.deleteAllocation(id, allocId); await audit('network.delete', { userId: user.id, target: id, metadata: { allocId } }); return { ok: true }; } catch (err) { return toFail(err); }
}
```

Run: `pnpm vitest run src/server/databases.test.ts` → PASS.

- [ ] **Step 3: Commit + Push**

```bash
git add src/server/databases.ts src/server/network.ts src/server/databases.test.ts
git commit -m "feat(server): guarded database + network actions"
git push
```

---

## Task 5: Startup·설정·활동 Server Actions (가드) [TDD]

**Files:**
- Create: `src/server/startup.ts`, `src/server/settings.ts`, `src/server/activity.ts`, `src/server/settings.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/server/settings.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null })) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { renameServerAction } from './settings';

const CLIENT = 'https://panel.test/api/client';
beforeEach(() => invalidateAccessCache());
function adminLists(idf: string) { mswServer.use(http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: { identifier: idf, uuid: `${idf}-0000-4000-8000-000000000000`, name: 'S' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } }))); }

describe('renameServerAction', () => {
  it('renames an accessible server', async () => {
    adminLists('1a2b3c4d');
    let body: any;
    mswServer.use(http.post(`${CLIENT}/servers/1a2b3c4d/settings/rename`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }));
    const res = await renameServerAction('1a2b3c4d', 'New');
    expect(res.ok).toBe(true);
    expect(body).toMatchObject({ name: 'New' });
  });
  it('not_found for inaccessible', async () => {
    adminLists('1a2b3c4d');
    expect(await renameServerAction('deadbeef', 'X')).toEqual({ ok: false, error: 'not_found' });
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/server/startup.ts`:
```ts
'use server';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier, type StartupVariable } from '@/lib/ptero/types';
import * as ptero from '@/lib/ptero/client';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser { return { id: u.id, role: u.role, pteroUserId: u.pteroUserId }; }
type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;
async function guard(identifier: string) { const user = await requireUser(); const id = asIdentifier(identifier); await requireServerAccess(scope(user), id); return { user, id }; }
function toFail(err: unknown): Fail { if (err instanceof ServerAccessDeniedError) return { ok: false, error: 'not_found' }; const detail = err instanceof PteroApiError ? err.primary?.detail : undefined; console.error('startup action failed', err); return { ok: false, error: 'failed', detail }; }

export async function getStartupAction(identifier: string): Promise<Ok<{ variables: StartupVariable[] }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, variables: await ptero.getStartupVariables(id) }; } catch (err) { return toFail(err); }
}
export async function updateStartupVariableAction(identifier: string, key: string, value: string): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.updateStartupVariable(id, key, value); await audit('startup.update', { userId: user.id, target: id, metadata: { key } }); return { ok: true }; } catch (err) { return toFail(err); }
}
```

`src/server/settings.ts`:
```ts
'use server';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier } from '@/lib/ptero/types';
import * as ptero from '@/lib/ptero/client';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser { return { id: u.id, role: u.role, pteroUserId: u.pteroUserId }; }
type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;
async function guard(identifier: string) { const user = await requireUser(); const id = asIdentifier(identifier); await requireServerAccess(scope(user), id); return { user, id }; }
function toFail(err: unknown): Fail { if (err instanceof ServerAccessDeniedError) return { ok: false, error: 'not_found' }; const detail = err instanceof PteroApiError ? err.primary?.detail : undefined; console.error('settings action failed', err); return { ok: false, error: 'failed', detail }; }

export async function renameServerAction(identifier: string, name: string, description?: string): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.renameServer(id, name, description); await audit('settings.rename', { userId: user.id, target: id }); return { ok: true }; } catch (err) { return toFail(err); }
}
export async function reinstallServerAction(identifier: string): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.reinstallServer(id); await audit('settings.reinstall', { userId: user.id, target: id }); return { ok: true }; } catch (err) { return toFail(err); }
}
export async function setDockerImageAction(identifier: string, dockerImage: string): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.setDockerImage(id, dockerImage); await audit('settings.docker_image', { userId: user.id, target: id }); return { ok: true }; } catch (err) { return toFail(err); }
}
```

`src/server/activity.ts`:
```ts
'use server';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier, type ActivityEntry } from '@/lib/ptero/types';
import * as ptero from '@/lib/ptero/client';
import { PteroApiError } from '@/lib/ptero/errors';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser { return { id: u.id, role: u.role, pteroUserId: u.pteroUserId }; }
type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;
async function guard(identifier: string) { const user = await requireUser(); const id = asIdentifier(identifier); await requireServerAccess(scope(user), id); return { id }; }

export async function listActivityAction(identifier: string): Promise<Ok<{ entries: ActivityEntry[] }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, entries: await ptero.listActivity(id) }; }
  catch (err) { if (err instanceof ServerAccessDeniedError) return { ok: false, error: 'not_found' }; const detail = err instanceof PteroApiError ? err.primary?.detail : undefined; console.error('activity action failed', err); return { ok: false, error: 'failed', detail }; }
}
```

Run: `pnpm vitest run src/server/settings.test.ts` → PASS.

- [ ] **Step 3: Commit + Push**

```bash
git add src/server/startup.ts src/server/settings.ts src/server/activity.ts src/server/settings.test.ts
git commit -m "feat(server): guarded startup/settings/activity actions"
git push
```

---

## Task 6: 탭 등록 + DB·네트워크 UI

**Files:**
- Modify: `src/registry/server-tabs.ts`, `src/registry/server-tabs.test.ts`
- Create: `src/features/databases/databases-view.tsx`, `src/features/network/network-view.tsx`, `src/app/(panel)/servers/[id]/databases/page.tsx`, `src/app/(panel)/servers/[id]/network/page.tsx`

- [ ] **Step 1: 탭 추가 + 테스트 갱신**

`src/registry/server-tabs.ts`의 `serverTabs`에 추가:
```ts
{ key: 'databases', label: '데이터베이스', href: (id) => `/servers/${id}/databases` },
{ key: 'network', label: '네트워크', href: (id) => `/servers/${id}/network` },
{ key: 'startup', label: 'Startup', href: (id) => `/servers/${id}/startup` },
{ key: 'settings', label: '설정', href: (id) => `/servers/${id}/settings` },
{ key: 'activity', label: '활동', href: (id) => `/servers/${id}/activity` },
```
`server-tabs.test.ts`의 built-in 검사에 위 키들 포함.

- [ ] **Step 2: DB 뷰 작성**

`src/features/databases/databases-view.tsx`:
```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { listDatabasesAction, createDatabaseAction, rotateDatabasePasswordAction, deleteDatabaseAction } from '@/server/databases';
import type { ServerDatabase } from '@/lib/ptero/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function DatabasesView({ identifier }: { identifier: string }) {
  const [dbs, setDbs] = useState<ServerDatabase[]>([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function load() { start(async () => { const r = await listDatabasesAction(identifier); if (r.ok) setDbs(r.databases); else setMsg(r.error === 'not_found' ? '서버를 찾을 수 없습니다.' : (r.detail ?? '실패')); }); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [identifier]);
  async function create(e: React.FormEvent) { e.preventDefault(); const r = await createDatabaseAction(identifier, name, '%'); if (r.ok) { setName(''); load(); } else setMsg(r.detail ?? '생성 실패'); }
  async function rotate(db: ServerDatabase) { const r = await rotateDatabasePasswordAction(identifier, db.id); if (r.ok) load(); else setMsg(r.detail ?? '실패'); }
  async function remove(db: ServerDatabase) { if (!confirm(`${db.name} 삭제?`)) return; const r = await deleteDatabaseAction(identifier, db.id); if (r.ok) load(); else setMsg(r.detail ?? '실패'); }
  return (
    <div className="space-y-3">
      <h2 className="font-medium">데이터베이스</h2>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card><form onSubmit={create} className="flex gap-2"><Input placeholder="DB 이름" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit">생성</Button></form></Card>
      <Card className="p-0"><table className="w-full text-sm"><thead><tr className="text-left text-zinc-500"><th className="px-4 py-2">이름</th><th className="px-4 py-2">호스트</th><th className="px-4 py-2">유저</th><th className="px-4 py-2">비밀번호</th><th /></tr></thead><tbody>
        {dbs.map((db) => (<tr key={db.id} className="border-t border-zinc-100 dark:border-zinc-800">
          <td className="px-4 py-2">{db.name}</td>
          <td className="px-4 py-2 text-zinc-500">{db.host.address}:{db.host.port}</td>
          <td className="px-4 py-2">{db.username}</td>
          <td className="px-4 py-2"><code className="text-xs">{db.password ?? '••••'}</code></td>
          <td className="px-4 py-2"><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => rotate(db)}>비번회전</Button><Button variant="ghost" onClick={() => remove(db)}>삭제</Button></div></td>
        </tr>))}
      </tbody></table></Card>
      {pending && <p className="text-xs text-zinc-400">불러오는 중…</p>}
    </div>
  );
}
```

- [ ] **Step 3: 네트워크 뷰 작성**

`src/features/network/network-view.tsx`:
```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { listAllocationsAction, assignAllocationAction, setPrimaryAllocationAction, setAllocationNoteAction, deleteAllocationAction } from '@/server/network';
import type { ServerAllocation } from '@/lib/ptero/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function NetworkView({ identifier }: { identifier: string }) {
  const [allocs, setAllocs] = useState<ServerAllocation[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function load() { start(async () => { const r = await listAllocationsAction(identifier); if (r.ok) setAllocs(r.allocations); else setMsg(r.error === 'not_found' ? '서버를 찾을 수 없습니다.' : (r.detail ?? '실패')); }); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [identifier]);
  async function assign() { const r = await assignAllocationAction(identifier); if (r.ok) load(); else setMsg(r.detail ?? '할당 실패'); }
  async function primary(a: ServerAllocation) { const r = await setPrimaryAllocationAction(identifier, a.id); if (r.ok) load(); else setMsg(r.detail ?? '실패'); }
  async function note(a: ServerAllocation) { const n = prompt('메모', a.notes ?? ''); if (n === null) return; const r = await setAllocationNoteAction(identifier, a.id, n); if (r.ok) load(); else setMsg(r.detail ?? '실패'); }
  async function remove(a: ServerAllocation) { if (a.is_default) { setMsg('기본 할당은 삭제할 수 없습니다.'); return; } if (!confirm('삭제?')) return; const r = await deleteAllocationAction(identifier, a.id); if (r.ok) load(); else setMsg(r.detail ?? '실패'); }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-medium">네트워크</h2><Button onClick={assign}>할당 추가</Button></div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card className="p-0"><table className="w-full text-sm"><tbody>
        {allocs.map((a) => (<tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800">
          <td className="px-4 py-2">{a.ip_alias ?? a.ip}:{a.port} {a.is_default && <span className="text-xs text-indigo-500">(기본)</span>}</td>
          <td className="px-4 py-2 text-zinc-500">{a.notes}</td>
          <td className="px-4 py-2"><div className="flex justify-end gap-2">{!a.is_default && <Button variant="ghost" onClick={() => primary(a)}>기본설정</Button>}<Button variant="ghost" onClick={() => note(a)}>메모</Button><Button variant="ghost" onClick={() => remove(a)}>삭제</Button></div></td>
        </tr>))}
      </tbody></table></Card>
      {pending && <p className="text-xs text-zinc-400">불러오는 중…</p>}
    </div>
  );
}
```

- [ ] **Step 4: 페이지 작성**

`src/app/(panel)/servers/[id]/databases/page.tsx`:
```tsx
import { DatabasesView } from '@/features/databases/databases-view';
export default async function DatabasesPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <DatabasesView identifier={id} />; }
```
`src/app/(panel)/servers/[id]/network/page.tsx`:
```tsx
import { NetworkView } from '@/features/network/network-view';
export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <NetworkView identifier={id} />; }
```

- [ ] **Step 5: 타입체크 + Commit + Push**

```bash
pnpm vitest run src/registry/server-tabs.test.ts && pnpm typecheck
git add src/registry/ src/features/databases/ src/features/network/ "src/app/(panel)/servers/[id]/databases/page.tsx" "src/app/(panel)/servers/[id]/network/page.tsx"
git commit -m "feat(ui): databases + network server tabs"
git push
```

---

## Task 7: Startup·설정·활동 UI

**Files:**
- Create: `src/features/startup/startup-view.tsx`, `src/features/settings/settings-view.tsx`, `src/features/activity/activity-view.tsx`, 각 `src/app/(panel)/servers/[id]/{startup,settings,activity}/page.tsx`

- [ ] **Step 1: Startup 뷰**

`src/features/startup/startup-view.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { getStartupAction, updateStartupVariableAction } from '@/server/startup';
import type { StartupVariable } from '@/lib/ptero/types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function StartupView({ identifier }: { identifier: string }) {
  const [vars, setVars] = useState<StartupVariable[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  async function load() { const r = await getStartupAction(identifier); if (r.ok) { setVars(r.variables); setValues(Object.fromEntries(r.variables.map((v) => [v.env_variable, v.server_value]))); } else setMsg(r.error === 'not_found' ? '서버를 찾을 수 없습니다.' : (r.detail ?? '실패')); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [identifier]);
  async function save(v: StartupVariable) { const r = await updateStartupVariableAction(identifier, v.env_variable, values[v.env_variable] ?? ''); setMsg(r.ok ? '저장됨' : (r.detail ?? '저장 실패')); }
  return (
    <div className="space-y-3">
      <h2 className="font-medium">Startup 변수</h2>
      {msg && <p className="text-sm text-zinc-500">{msg}</p>}
      {vars.map((v) => (
        <Card key={v.env_variable} className="flex items-end gap-2">
          <label className="flex-1 text-sm"><span className="text-zinc-500">{v.name} ({v.env_variable})</span>
            <Input value={values[v.env_variable] ?? ''} disabled={!v.is_editable} onChange={(e) => setValues({ ...values, [v.env_variable]: e.target.value })} />
          </label>
          {v.is_editable && <Button onClick={() => save(v)}>저장</Button>}
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 설정 뷰**

`src/features/settings/settings-view.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { renameServerAction, reinstallServerAction, setDockerImageAction } from '@/server/settings';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function SettingsView({ identifier, currentName }: { identifier: string; currentName: string }) {
  const [name, setName] = useState(currentName);
  const [image, setImage] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  async function rename() { const r = await renameServerAction(identifier, name); setMsg(r.ok ? '이름 변경됨' : (r.detail ?? '실패')); }
  async function reinstall() { if (!confirm('재설치하면 서버 파일이 초기화될 수 있습니다. 계속할까요?')) return; const r = await reinstallServerAction(identifier); setMsg(r.ok ? '재설치를 시작했습니다.' : (r.detail ?? '실패')); }
  async function changeImage() { if (!image) return; const r = await setDockerImageAction(identifier, image); setMsg(r.ok ? '이미지 변경됨' : (r.detail ?? '실패')); }
  return (
    <div className="space-y-3">
      <h2 className="font-medium">설정</h2>
      {msg && <p className="text-sm text-zinc-500">{msg}</p>}
      <Card className="flex items-end gap-2"><label className="flex-1 text-sm"><span className="text-zinc-500">서버 이름</span><Input value={name} onChange={(e) => setName(e.target.value)} /></label><Button onClick={rename}>변경</Button></Card>
      <Card className="flex items-end gap-2"><label className="flex-1 text-sm"><span className="text-zinc-500">Docker 이미지</span><Input placeholder="새 이미지" value={image} onChange={(e) => setImage(e.target.value)} /></label><Button onClick={changeImage}>변경</Button></Card>
      <Card><h3 className="mb-2 text-sm font-medium text-red-600">위험 구역</h3><Button variant="danger" onClick={reinstall}>서버 재설치</Button></Card>
    </div>
  );
}
```

- [ ] **Step 3: 활동 뷰**

`src/features/activity/activity-view.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { listActivityAction } from '@/server/activity';
import type { ActivityEntry } from '@/lib/ptero/types';
import { Card } from '@/components/ui/card';

export function ActivityView({ identifier }: { identifier: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { (async () => { const r = await listActivityAction(identifier); if (r.ok) setEntries(r.entries); else setMsg(r.error === 'not_found' ? '서버를 찾을 수 없습니다.' : (r.detail ?? '실패')); })(); }, [identifier]);
  return (
    <div className="space-y-3">
      <h2 className="font-medium">활동 로그</h2>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card className="p-0"><table className="w-full text-sm"><tbody>
        {entries.map((e) => (<tr key={e.id} className="border-t border-zinc-100 dark:border-zinc-800">
          <td className="px-4 py-2">{e.event}</td>
          <td className="px-4 py-2 text-zinc-500">{e.ip}</td>
          <td className="px-4 py-2 text-right text-zinc-400">{new Date(e.timestamp).toLocaleString()}</td>
        </tr>))}
      </tbody></table></Card>
    </div>
  );
}
```

- [ ] **Step 4: 페이지 작성**

`src/app/(panel)/servers/[id]/startup/page.tsx`:
```tsx
import { StartupView } from '@/features/startup/startup-view';
export default async function StartupPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <StartupView identifier={id} />; }
```
`src/app/(panel)/servers/[id]/settings/page.tsx`:
```tsx
import { getServerOverview } from '@/server/servers';
import { SettingsView } from '@/features/settings/settings-view';
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { attributes } = await getServerOverview(id); // 가드 + 현재 이름
  return <SettingsView identifier={id} currentName={(attributes as { name?: string }).name ?? id} />;
}
```
`src/app/(panel)/servers/[id]/activity/page.tsx`:
```tsx
import { ActivityView } from '@/features/activity/activity-view';
export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ActivityView identifier={id} />; }
```

- [ ] **Step 5: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add src/features/startup/ src/features/settings/ src/features/activity/ "src/app/(panel)/servers/[id]/startup/page.tsx" "src/app/(panel)/servers/[id]/settings/page.tsx" "src/app/(panel)/servers/[id]/activity/page.tsx"
git commit -m "feat(ui): startup/settings/activity server tabs"
git push
```

---

## Task 8: e2e + 최종 검증

**Files:**
- Modify: `e2e/mock-panel.mjs`, `README.md`
- Create: `e2e/server-detail.spec.ts`

- [ ] **Step 1: mock 패널 확장 (server '1a2b3c4d')**

`e2e/mock-panel.mjs`에 추가:
```js
if (p === '/api/client/servers/1a2b3c4d/databases') return json({ object: 'list', data: [{ object: 'server_database', attributes: { id: 'H1', name: 's1_default', username: 'u', host: { address: '10.0.0.1', port: 3306 }, connections_from: '%', max_connections: 0 } }] });
if (p === '/api/client/servers/1a2b3c4d/network/allocations') return json({ object: 'list', data: [{ object: 'allocation', attributes: { id: 1, ip: '0.0.0.0', ip_alias: null, port: 25565, notes: null, is_default: true } }] });
if (p === '/api/client/servers/1a2b3c4d/startup') return json({ object: 'list', data: [{ object: 'egg_variable', attributes: { name: 'Version', description: '', env_variable: 'MC_VERSION', default_value: 'latest', server_value: '1.20', is_editable: true, rules: 'required|string' } }], meta: { startup_command: 'java' } });
if (p === '/api/client/servers/1a2b3c4d/activity') return json({ object: 'list', data: [{ object: 'activity_log', attributes: { id: 'a1', event: 'server:console.command', ip: '1.2.3.4', description: null, timestamp: '2026-01-01T00:00:00Z' } }], meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } } });
```

- [ ] **Step 2: e2e 스펙**

`e2e/server-detail.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
async function login(page, id: string, pw: string) { await page.goto('/login'); await page.fill('input[name="identifier"]', id); await page.fill('input[name="password"]', pw); await page.click('button[type="submit"]'); await page.waitForURL('**/servers'); }

test('USER sees databases tab', async ({ page }) => { await login(page, 'user', 'user-pass'); await page.goto('/servers/1a2b3c4d/databases'); await expect(page.getByText('s1_default')).toBeVisible(); });
test('USER sees network allocation', async ({ page }) => { await login(page, 'user', 'user-pass'); await page.goto('/servers/1a2b3c4d/network'); await expect(page.getByText('25565')).toBeVisible(); });
test('USER sees startup variable', async ({ page }) => { await login(page, 'user', 'user-pass'); await page.goto('/servers/1a2b3c4d/startup'); await expect(page.getByText('MC_VERSION')).toBeVisible(); });
test('detail tab on non-owned server is 404', async ({ page }) => { await login(page, 'user', 'user-pass'); const res = await page.goto('/servers/9z9z9z9z/databases'); expect(res?.status()).toBe(404); });
```

- [ ] **Step 3: 전체 검증 + README**

`README.md` 기능 목록에 "데이터베이스·네트워크·Startup·설정·활동로그" 반영.
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
```
Expected: 전부 그린.

- [ ] **Step 4: Commit + Push**

```bash
git add e2e/ README.md
git commit -m "test(e2e): server detail tabs (databases/network/startup) + README"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지:** 부록 A §3.5 DB ✓T1,4,6 · §3.7 네트워크 ✓T2,4,6 · §3.9 Startup ✓T3,5,7 · §3.10 설정(rename/reinstall/image) ✓T3,5,7 · §3.1 활동 ✓T3,5,7 · §4 인가(모든 액션 guard·404) ✓T4,5,8 · 탭 레지스트리 ✓T6.
- **보안:** 모든 액션 `guard()` 선행. 키 서버 전용. DB 비밀번호는 include=password로 받아 표시(브라우저 노출은 관리 화면 한정, 키 아님). 기본 할당 삭제 차단·재설치 확인(UI).
- **플레이스홀더 스캔:** 모든 코드/명령 실측.
- **타입 일관성:** `Ok/Fail` 패턴이 files/backups와 동일. `ServerDatabase/ServerAllocation/StartupVariable/ActivityEntry` 공유. 클라이언트 settings의 `renameServer/reinstallServer`가 기존 함수와 이름 충돌 없는지 확인(Task 3 주석). `serverTabs` 확장이 `[id]/layout.tsx`와 호환.
- **환경 의존:** 단위(MSW, 패널 불필요)/e2e(mock 패널 + 시드 DB).

---

## 다음
Plan 4b(스케줄+태스크) · Plan 4c(서브유저 + `ServerAccess` 캐시로 스코프 확장)로 이어진다. 이후 Phase 5(마감) → Phase 6(플러그인).
