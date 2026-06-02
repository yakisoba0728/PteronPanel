# Pteron Panel — Subusers & Scope Expansion 구현 계획 (Phase 4c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (A) 서버 뷰에 **서브유저** 탭(목록·초대·권한수정·제거)을 추가하고, (B) **멀티테넌트 스코프를 확장** — 지금까지 USER는 *소유* 서버만 봤지만, 이제 *서브유저로 참여 중인* 서버도 보이게 한다. spec §4.6대로 "유저가 서브유저인 서버" 목록은 Application API에 없으므로, **`ServerAccess` 캐시 테이블 + 관리자 트리거 동기화**(전 서버를 돌며 서브유저 수집, O(서버수))로 해결하고 요청 경로 밖에서 채운다.

**Architecture:** 서브유저 관리는 files/backups 패턴(Client API 래퍼 → 가드 액션 → 서버 탭). 스코프 확장은 `prisma`에 `ServerAccess`(pteroUuid↔서버) 테이블을 두고, 관리자 액션 `syncServerAccessAction`이 `client.listServers('admin-all')` → 각 서버 `client.listSubusers()` → SUBUSER 링크를 upsert(오래된 행 정리). `resolveAccessibleServers`의 USER 경로는 **소유(application, live) ∪ ServerAccess(서브유저, 캐시)** 합집합으로 바뀐다(소유는 항상 라이브라 권위 유지, 서브유저만 캐시).

**Tech Stack:** 기존 스택 + Prisma 마이그레이션. **선행:** Phase 4a/4b 완료, `resolveAccessibleServers`/`requireServerAccess`/`requireAdmin` 존재. 참조 spec: §4.1·§4.6(스코프·서브유저 한계), 부록 A §3.8(Subusers)·§3.11(permissions), §15.

> **표준 규칙:** 각 Task commit + push(작업 브랜치). **AI 워터마크 금지.** **워크트리**에서 작업.

> **⚠️ 레이트리밋 주의:** 동기화는 서버 1개당 `listSubusers` 1회 호출 → 단일 admin Client 키(720/분) 사용. 대규모 fleet은 분당 720개로 제한되므로 동기화를 **순차+페이싱**하고, 진행/제한을 로깅한다. 관리자 수동 트리거(요청 경로 밖). 주기 실행은 후속(외부 cron/Pteron 스케줄)로.

---

## File Structure (Phase 4c 범위)

| 파일 | 책임 |
|---|---|
| `prisma/schema.prisma`(수정) | `ServerAccess` 모델 + 마이그레이션 |
| `src/lib/ptero/types.ts`(수정) | `Subuser` |
| `src/lib/ptero/client.ts`(수정) | 서브유저 + permissions 래퍼 |
| `src/server/subusers.ts` | 가드된 서브유저 액션(per-server) |
| `src/server/admin/sync.ts` | `syncServerAccessAction`(requireAdmin) |
| `src/lib/authz/access.ts`(수정) | USER 스코프 = 소유 ∪ ServerAccess(서브유저) |
| `src/registry/server-tabs.ts`(수정) | `subusers` 탭 |
| `src/app/(panel)/servers/[id]/subusers/page.tsx` + `src/features/subusers/subusers-view.tsx` | UI |
| `src/features/admin/sync-button.tsx` + `admin/page.tsx`(수정) | 관리자 동기화 버튼 |
| `e2e/*`(수정) | mock 확장 + e2e |

---

## Task 1: `ServerAccess` 모델 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 모델 추가**

`prisma/schema.prisma`에 추가:
```prisma
model ServerAccess {
  id               String   @id @default(cuid())
  pteroUuid        String   // Pterodactyl user uuid of a SUBUSER on the server
  serverIdentifier String   // 8-char client identifier
  serverUuid       String
  serverName       String
  syncedAt         DateTime @default(now())

  @@unique([pteroUuid, serverIdentifier])
  @@index([pteroUuid])
  @@index([syncedAt])
}
```
> 소유 서버는 캐시하지 않는다(Application API로 라이브 해석). 이 테이블은 **서브유저 링크 전용 캐시**다.

- [ ] **Step 2: 마이그레이션 + 검증**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm prisma migrate dev --name server_access
pnpm prisma generate
```
Expected: `prisma/migrations/<ts>_server_access/` 생성, 클라이언트 재생성.

- [ ] **Step 3: Commit + Push**

```bash
git add prisma/
git commit -m "feat(db): ServerAccess subuser-link cache table"
git push
```

---

## Task 2: 서브유저 + permissions 클라이언트 래퍼 [TDD]

**Files:**
- Modify: `src/lib/ptero/types.ts`, `src/lib/ptero/client.ts`
- Create: `src/lib/ptero/client.subusers.test.ts`

- [ ] **Step 1: 타입 추가**

```ts
export interface Subuser {
  uuid: string;
  username: string;
  email: string;
  image: string;
  permissions: string[];
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/ptero/client.subusers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listSubusers, createSubuser, updateSubuser, deleteSubuser, listPermissionKeys } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');
const sub = (over = {}) => ({ object: 'server_subuser', attributes: { uuid: 'sub-uuid', username: 'bob', email: 'bob@x.com', image: '', permissions: ['control.console', 'file.read'], ...over } });

describe('client subusers', () => {
  it('listSubusers maps', async () => {
    mswServer.use(http.get(`${BASE}/servers/1a2b3c4d/users`, () => HttpResponse.json({ object: 'list', data: [sub()] })));
    expect((await listSubusers(id))[0]).toMatchObject({ uuid: 'sub-uuid', email: 'bob@x.com', permissions: ['control.console', 'file.read'] });
  });
  it('createSubuser posts {email, permissions}', async () => {
    let body: any;
    mswServer.use(http.post(`${BASE}/servers/1a2b3c4d/users`, async ({ request }) => { body = await request.json(); return HttpResponse.json(sub()); }));
    await createSubuser(id, 'bob@x.com', ['control.console']);
    expect(body).toEqual({ email: 'bob@x.com', permissions: ['control.console'] });
  });
  it('updateSubuser posts {permissions}', async () => {
    let body: any;
    mswServer.use(http.post(`${BASE}/servers/1a2b3c4d/users/sub-uuid`, async ({ request }) => { body = await request.json(); return HttpResponse.json(sub({ permissions: ['control.console', 'control.start'] })); }));
    await updateSubuser(id, 'sub-uuid', ['control.console', 'control.start']);
    expect(body).toEqual({ permissions: ['control.console', 'control.start'] });
  });
  it('deleteSubuser DELETEs', async () => {
    let called = false;
    mswServer.use(http.delete(`${BASE}/servers/1a2b3c4d/users/sub-uuid`, () => { called = true; return new HttpResponse(null, { status: 204 }); }));
    await deleteSubuser(id, 'sub-uuid');
    expect(called).toBe(true);
  });
  it('listPermissionKeys flattens group.key', async () => {
    mswServer.use(http.get(`${BASE}/permissions`, () => HttpResponse.json({ object: 'system_permissions', attributes: { permissions: { control: { description: '', keys: { console: '', start: '' } }, file: { description: '', keys: { read: '' } } } } })));
    const keys = await listPermissionKeys();
    expect(keys).toEqual(expect.arrayContaining(['control.console', 'control.start', 'file.read']));
  });
});
```

- [ ] **Step 3: 실패 확인 → 구현**

`src/lib/ptero/client.ts`에 추가(상단 import에 `Subuser` 추가; `pathSegment`로 uuid 인코딩):
```ts
export async function listSubusers(id: ServerIdentifier): Promise<Subuser[]> {
  const res = await pteroFetch<PteroList<Subuser>>('client', `/servers/${id}/users`);
  return res.data.map((d) => d.attributes);
}
export async function createSubuser(id: ServerIdentifier, email: string, permissions: string[]): Promise<Subuser> {
  const res = await pteroFetch<PteroItem<Subuser>>('client', `/servers/${id}/users`, { method: 'POST', body: { email, permissions } });
  return res.attributes;
}
export async function updateSubuser(id: ServerIdentifier, subuserUuid: string, permissions: string[]): Promise<Subuser> {
  const res = await pteroFetch<PteroItem<Subuser>>('client', `/servers/${id}/users/${pathSegment(subuserUuid)}`, { method: 'POST', body: { permissions } });
  return res.attributes;
}
export async function deleteSubuser(id: ServerIdentifier, subuserUuid: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/users/${pathSegment(subuserUuid)}`, { method: 'DELETE' });
}
export async function listPermissionKeys(): Promise<string[]> {
  const res = await pteroFetch<{ attributes: { permissions: Record<string, { keys: Record<string, string> }> } }>('client', '/permissions');
  const out: string[] = [];
  for (const [group, def] of Object.entries(res.attributes.permissions)) {
    if (group === 'websocket') continue; // websocket.connect is implicit
    for (const key of Object.keys(def.keys)) out.push(`${group}.${key}`);
  }
  return out;
}
```

Run: `pnpm vitest run src/lib/ptero/client.subusers.test.ts` → PASS.

- [ ] **Step 4: Commit + Push**

```bash
git add src/lib/ptero/types.ts src/lib/ptero/client.ts src/lib/ptero/client.subusers.test.ts
git commit -m "feat(ptero): client subuser + permissions endpoints"
git push
```

---

## Task 3: 서브유저 Server Actions (가드) [TDD]

**Files:**
- Create: `src/server/subusers.ts`, `src/server/subusers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/server/subusers.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null })) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { listSubusersAction, createSubuserAction } from './subusers';

const CLIENT = 'https://panel.test/api/client';
beforeEach(() => invalidateAccessCache());
function adminLists(idf: string) { mswServer.use(http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: { identifier: idf, uuid: `${idf}-0000-4000-8000-000000000000`, name: 'S' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } }))); }

describe('subuser actions', () => {
  it('lists subusers for accessible server', async () => {
    adminLists('1a2b3c4d');
    mswServer.use(http.get(`${CLIENT}/servers/1a2b3c4d/users`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server_subuser', attributes: { uuid: 's1', username: 'b', email: 'b@x.com', image: '', permissions: ['control.console'] } }] })));
    const res = await listSubusersAction('1a2b3c4d');
    expect(res.ok && res.subusers[0].uuid).toBe('s1');
  });
  it('not_found for inaccessible', async () => {
    adminLists('1a2b3c4d');
    expect(await listSubusersAction('deadbeef')).toEqual({ ok: false, error: 'not_found' });
  });
  it('createSubuser validates email', async () => {
    adminLists('1a2b3c4d');
    const res = await createSubuserAction('1a2b3c4d', 'not-an-email', ['control.console']);
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/server/subusers.ts`:
```ts
'use server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier, type Subuser } from '@/lib/ptero/types';
import * as ptero from '@/lib/ptero/client';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser { return { id: u.id, role: u.role, pteroUserId: u.pteroUserId }; }
type Fail = { ok: false; error: 'not_found' | 'failed' | 'validation'; detail?: string };
type Ok<T> = { ok: true } & T;
async function guard(identifier: string) { const user = await requireUser(); const id = asIdentifier(identifier); await requireServerAccess(scope(user), id); return { user, id }; }
function toFail(err: unknown): Fail {
  if (err instanceof ServerAccessDeniedError) return { ok: false, error: 'not_found' };
  if (err instanceof z.ZodError) return { ok: false, error: 'validation', detail: err.issues[0]?.message };
  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('subuser action failed', err); return { ok: false, error: 'failed', detail };
}

export async function listSubusersAction(identifier: string): Promise<Ok<{ subusers: Subuser[] }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, subusers: await ptero.listSubusers(id) }; } catch (err) { return toFail(err); }
}
export async function getPermissionsAction(identifier: string): Promise<Ok<{ keys: string[] }> | Fail> {
  try { await guard(identifier); return { ok: true, keys: await ptero.listPermissionKeys() }; } catch (err) { return toFail(err); }
}
const emailSchema = z.string().email();
const permsSchema = z.array(z.string().regex(/^[a-z_]+\.[a-z_-]+$/)).min(1);
export async function createSubuserAction(identifier: string, email: string, permissions: string[]): Promise<Ok<{ subuser: Subuser }> | Fail> {
  try { const { user, id } = await guard(identifier); const e = emailSchema.parse(email); const p = permsSchema.parse(permissions); const s = await ptero.createSubuser(id, e, p); await audit('subuser.create', { userId: user.id, target: id, metadata: { email: e } }); return { ok: true, subuser: s }; } catch (err) { return toFail(err); }
}
export async function updateSubuserAction(identifier: string, subuserUuid: string, permissions: string[]): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); const p = permsSchema.parse(permissions); await ptero.updateSubuser(id, subuserUuid, p); await audit('subuser.update', { userId: user.id, target: id, metadata: { subuserUuid } }); return { ok: true }; } catch (err) { return toFail(err); }
}
export async function deleteSubuserAction(identifier: string, subuserUuid: string): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.deleteSubuser(id, subuserUuid); await audit('subuser.delete', { userId: user.id, target: id, metadata: { subuserUuid } }); return { ok: true }; } catch (err) { return toFail(err); }
}
```

Run: `pnpm vitest run src/server/subusers.test.ts` → PASS.

- [ ] **Step 3: Commit + Push**

```bash
git add src/server/subusers.ts src/server/subusers.test.ts
git commit -m "feat(server): guarded subuser actions"
git push
```

---

## Task 4: ServerAccess 동기화 서비스 + 관리자 액션 [TDD]

**Files:**
- Create: `src/lib/authz/sync.ts`, `src/server/admin/sync.ts`, `src/lib/authz/sync.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (동기화 로직)**

`src/lib/authz/sync.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

const calls: any[] = [];
const prismaMock = {
  serverAccess: {
    upsert: vi.fn(async (args: any) => { calls.push(['upsert', args.where]); return {}; }),
    deleteMany: vi.fn(async (args: any) => { calls.push(['deleteMany', args.where]); return { count: 0 }; }),
  },
};
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { syncServerAccess } from './sync';

const CLIENT = 'https://panel.test/api/client';

describe('syncServerAccess', () => {
  it('records a SUBUSER link per (subuser, server) and prunes stale rows', async () => {
    mswServer.use(
      http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: { identifier: '1a2b3c4d', uuid: '1a2b3c4d-0000-4000-8000-000000000000', name: 'Alpha' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })),
      http.get(`${CLIENT}/servers/1a2b3c4d/users`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server_subuser', attributes: { uuid: 'sub-1', username: 'b', email: 'b@x.com', image: '', permissions: [] } }] })),
    );
    const result = await syncServerAccess();
    expect(result.servers).toBe(1);
    expect(result.subuserLinks).toBe(1);
    expect(prismaMock.serverAccess.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pteroUuid_serverIdentifier: { pteroUuid: 'sub-1', serverIdentifier: '1a2b3c4d' } } }));
    expect(prismaMock.serverAccess.deleteMany).toHaveBeenCalled(); // stale prune
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/authz/sync.ts`:
```ts
import { prisma } from '@/lib/db';
import { listServers, listSubusers } from '@/lib/ptero/client';

export interface SyncResult {
  servers: number;
  subuserLinks: number;
  startedAt: number; // epoch ms (caller passes? no — see note)
}

/**
 * Rebuilds the ServerAccess subuser-link cache.
 * Lists ALL servers (admin-all), then for each server lists its subusers and
 * upserts a (pteroUuid -> server) row. Rows not touched this run are pruned.
 * O(#servers) Client API calls on the single admin key — run off the request path.
 */
export async function syncServerAccess(now: Date = new Date()): Promise<{ servers: number; subuserLinks: number }> {
  const servers = await listServers('admin-all');
  let links = 0;
  for (const s of servers) {
    const subs = await listSubusers(s.identifier);
    for (const sub of subs) {
      await prisma.serverAccess.upsert({
        where: { pteroUuid_serverIdentifier: { pteroUuid: sub.uuid, serverIdentifier: s.identifier } },
        update: { serverUuid: s.uuid, serverName: s.name, syncedAt: now },
        create: { pteroUuid: sub.uuid, serverIdentifier: s.identifier, serverUuid: s.uuid, serverName: s.name, syncedAt: now },
      });
      links += 1;
    }
  }
  // prune rows not refreshed this run (stale subuser links / deleted servers)
  await prisma.serverAccess.deleteMany({ where: { syncedAt: { lt: now } } });
  return { servers: servers.length, subuserLinks: links };
}
```
> `new Date()`는 앱 런타임에서 정상(워크플로 스크립트 제약과 무관). 각 row의 `syncedAt`을 이번 실행의 `now`로 통일해 prune이 정확하다.

`src/server/admin/sync.ts`:
```ts
'use server';
import { requireUser } from '@/lib/auth/current-user';
import { assertAdmin, AdminRequiredError } from '@/lib/authz/admin';
import { syncServerAccess } from '@/lib/authz/sync';
import { invalidateAccessCache } from '@/lib/authz/access';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';

type Fail = { ok: false; error: 'forbidden' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;

export async function syncServerAccessAction(): Promise<Ok<{ servers: number; subuserLinks: number }> | Fail> {
  try {
    const user = await requireUser();
    assertAdmin(user);
    const result = await syncServerAccess();
    invalidateAccessCache(); // refresh everyone's scope on next request
    await audit('admin.scope.sync', { userId: user.id, metadata: result });
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof AdminRequiredError) return { ok: false, error: 'forbidden' };
    const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
    console.error('scope sync failed', err);
    return { ok: false, error: 'failed', detail };
  }
}
```

Run: `pnpm vitest run src/lib/authz/sync.test.ts` → PASS.

- [ ] **Step 3: Commit + Push**

```bash
git add src/lib/authz/sync.ts src/server/admin/sync.ts src/lib/authz/sync.test.ts
git commit -m "feat(authz): ServerAccess sync service + admin sync action"
git push
```

---

## Task 5: 스코프 확장 — `resolveAccessibleServers` (소유 ∪ 서브유저) [TDD]

**Files:**
- Modify: `src/lib/authz/access.ts`
- Create: `src/lib/authz/access.subuser.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/authz/access.subuser.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

const prismaMock = {
  user: { findUnique: vi.fn(async () => ({ pteroUuid: 'user-uuid-7' })) },
  serverAccess: { findMany: vi.fn(async () => [{ serverIdentifier: 'bbbbbbbb', serverUuid: 'bbbbbbbb-0000-4000-8000-000000000000', serverName: 'Shared' }]) },
};
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { resolveAccessibleServers, invalidateAccessCache } from './access';

const APP = 'https://panel.test/api/application';
beforeEach(() => { invalidateAccessCache(); vi.clearAllMocks(); prismaMock.user.findUnique.mockResolvedValue({ pteroUuid: 'user-uuid-7' } as any); prismaMock.serverAccess.findMany.mockResolvedValue([{ serverIdentifier: 'bbbbbbbb', serverUuid: 'bbbbbbbb-0000-4000-8000-000000000000', serverName: 'Shared' }] as any); });

describe('resolveAccessibleServers with subuser scope', () => {
  it('USER sees owned + subuser servers (deduped)', async () => {
    mswServer.use(http.get(`${APP}/users/7`, () => HttpResponse.json({ object: 'user', attributes: { id: 7, relationships: { servers: { object: 'list', data: [{ object: 'server', attributes: { id: 1, identifier: 'aaaaaaaa', uuid: 'aaaaaaaa-0000-4000-8000-000000000000', name: 'Owned' } }] } } } })));
    const out = await resolveAccessibleServers({ id: 'u-7', role: 'USER', pteroUserId: 7 });
    expect(out.map((s) => s.identifier).sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });
  it('does not duplicate a server that is both owned and a subuser row', async () => {
    prismaMock.serverAccess.findMany.mockResolvedValue([{ serverIdentifier: 'aaaaaaaa', serverUuid: 'aaaaaaaa-0000-4000-8000-000000000000', serverName: 'Owned' }] as any);
    mswServer.use(http.get(`${APP}/users/7`, () => HttpResponse.json({ object: 'user', attributes: { id: 7, relationships: { servers: { object: 'list', data: [{ object: 'server', attributes: { id: 1, identifier: 'aaaaaaaa', uuid: 'aaaaaaaa-0000-4000-8000-000000000000', name: 'Owned' } }] } } } })));
    const out = await resolveAccessibleServers({ id: 'u-7', role: 'USER', pteroUserId: 7 });
    expect(out.map((s) => s.identifier)).toEqual(['aaaaaaaa']);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/authz/access.ts` 의 USER 분기를 수정한다. 상단에 `import { prisma } from '@/lib/db';` 와 `import { asIdentifier, asUuid } from '@/lib/ptero/types';` 추가(이미 있으면 생략). `resolveAccessibleServers`의 `user.role === 'ADMIN'` 외 분기를:
```ts
} else if (user.pteroUserId != null) {
  const owned = await getOwnedServers(user.pteroUserId);
  const ownedIds = new Set(owned.map((s) => String(s.identifier)));
  // subuser-accessible servers from the ServerAccess cache (Task 4 sync populates it)
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { pteroUuid: true } });
  let subuser: AccessibleServer[] = [];
  if (dbUser?.pteroUuid) {
    const rows = await prisma.serverAccess.findMany({ where: { pteroUuid: dbUser.pteroUuid } });
    subuser = rows
      .filter((r) => !ownedIds.has(r.serverIdentifier))
      .map((r) => ({ identifier: asIdentifier(r.serverIdentifier), uuid: asUuid(r.serverUuid), name: r.serverName }));
  }
  servers = [...owned, ...subuser];
} else {
  servers = [];
}
```
(ADMIN 분기와 캐시 로직은 그대로 유지.)

Run: `pnpm vitest run src/lib/authz/access.subuser.test.ts src/lib/authz/access.test.ts` → PASS(기존 access 테스트도 통과 유지; ADMIN/unmapped 경로 불변).

- [ ] **Step 3: Commit + Push**

```bash
git add src/lib/authz/access.ts src/lib/authz/access.subuser.test.ts
git commit -m "feat(authz): expand USER scope to subuser servers via ServerAccess cache"
git push
```

---

## Task 6: 서브유저 UI (탭) + 관리자 동기화 버튼

**Files:**
- Modify: `src/registry/server-tabs.ts`, `src/registry/server-tabs.test.ts`, `src/app/(panel)/admin/page.tsx`
- Create: `src/features/subusers/subusers-view.tsx`, `src/app/(panel)/servers/[id]/subusers/page.tsx`, `src/features/admin/sync-button.tsx`

- [ ] **Step 1: 탭 추가 + 테스트 갱신**

`src/registry/server-tabs.ts`의 `serverTabs`에 추가:
```ts
{ key: 'subusers', label: '서브유저', href: (id) => `/servers/${id}/subusers` },
```
`server-tabs.test.ts` built-in 검사에 `'subusers'` 포함.

- [ ] **Step 2: 서브유저 뷰 작성**

`src/features/subusers/subusers-view.tsx`:
```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { listSubusersAction, getPermissionsAction, createSubuserAction, updateSubuserAction, deleteSubuserAction } from '@/server/subusers';
import type { Subuser } from '@/lib/ptero/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function SubusersView({ identifier }: { identifier: string }) {
  const [subusers, setSubusers] = useState<Subuser[]>([]);
  const [allKeys, setAllKeys] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(['control.console']));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const [s, p] = await Promise.all([listSubusersAction(identifier), getPermissionsAction(identifier)]);
      if (s.ok) setSubusers(s.subusers); else setMsg(s.error === 'not_found' ? '서버를 찾을 수 없습니다.' : (s.detail ?? '실패'));
      if (p.ok) setAllKeys(p.keys);
    });
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [identifier]);

  function toggle(key: string) { const n = new Set(selected); n.has(key) ? n.delete(key) : n.add(key); setSelected(n); }
  async function create(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const r = await createSubuserAction(identifier, email, [...selected]);
    if (r.ok) { setEmail(''); load(); } else setMsg(r.detail ?? (r.error === 'validation' ? '이메일/권한을 확인하세요.' : '초대 실패'));
  }
  async function remove(s: Subuser) { if (!confirm(`${s.email} 제거?`)) return; const r = await deleteSubuserAction(identifier, s.uuid); if (r.ok) load(); else setMsg(r.detail ?? '실패'); }
  async function togglePerm(s: Subuser, key: string) {
    const next = s.permissions.includes(key) ? s.permissions.filter((k) => k !== key) : [...s.permissions, key];
    const r = await updateSubuserAction(identifier, s.uuid, next);
    if (r.ok) load(); else setMsg(r.detail ?? '권한 변경 실패');
  }

  return (
    <div className="space-y-3">
      <h2 className="font-medium">서브유저</h2>
      {msg && <p className="text-sm text-zinc-500">{msg}</p>}
      <Card className="space-y-2">
        <h3 className="text-sm font-medium">초대</h3>
        <form onSubmit={create} className="space-y-2">
          <div className="flex gap-2"><Input placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} /><Button type="submit">초대</Button></div>
          <div className="flex flex-wrap gap-2 text-xs">
            {allKeys.map((k) => (
              <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} />{k}</label>
            ))}
          </div>
        </form>
      </Card>
      {subusers.map((s) => (
        <Card key={s.uuid} className="space-y-2">
          <div className="flex items-center justify-between"><span className="font-medium">{s.email}</span><Button variant="ghost" onClick={() => remove(s)}>제거</Button></div>
          <div className="flex flex-wrap gap-2 text-xs">
            {allKeys.map((k) => (
              <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={s.permissions.includes(k)} onChange={() => togglePerm(s, k)} />{k}</label>
            ))}
          </div>
        </Card>
      ))}
      {pending && <p className="text-xs text-zinc-400">불러오는 중…</p>}
    </div>
  );
}
```

- [ ] **Step 3: 관리자 동기화 버튼**

`src/features/admin/sync-button.tsx`:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { syncServerAccessAction } from '@/server/admin/sync';
import { Button } from '@/components/ui/button';

export function SyncButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  function run() {
    setMsg(null);
    start(async () => {
      const r = await syncServerAccessAction();
      setMsg(r.ok ? `동기화 완료: 서버 ${r.servers}개, 서브유저 링크 ${r.subuserLinks}개` : (r.error === 'forbidden' ? '권한 없음' : (r.detail ?? '동기화 실패')));
    });
  }
  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={pending}>{pending ? '동기화 중…' : '서브유저 접근 동기화'}</Button>
      {msg && <p className="text-sm text-zinc-500">{msg}</p>}
      <p className="text-xs text-zinc-400">전 서버를 순회해 서브유저 접근 캐시를 갱신합니다(서버 수만큼 API 호출). 서버가 많으면 시간이 걸릴 수 있습니다.</p>
    </div>
  );
}
```
`src/app/(panel)/admin/page.tsx`에 SyncButton 추가:
```tsx
import { SyncButton } from '@/features/admin/sync-button';
export default function AdminHome() {
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold">관리자</h1><p className="mt-2 text-sm text-zinc-500">유저·서버·노드·로케이션을 관리하세요.</p></div>
      <div><h2 className="mb-1 text-sm font-medium">서브유저 스코프</h2><SyncButton /></div>
    </div>
  );
}
```

- [ ] **Step 4: 페이지 작성**

`src/app/(panel)/servers/[id]/subusers/page.tsx`:
```tsx
import { SubusersView } from '@/features/subusers/subusers-view';
export default async function SubusersPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <SubusersView identifier={id} />; }
```

- [ ] **Step 5: 타입체크 + Commit + Push**

```bash
pnpm vitest run src/registry/server-tabs.test.ts && pnpm typecheck
git add src/registry/ src/features/subusers/ src/features/admin/sync-button.tsx "src/app/(panel)/admin/page.tsx" "src/app/(panel)/servers/[id]/subusers/page.tsx"
git commit -m "feat(ui): subusers server tab + admin scope-sync button"
git push
```

---

## Task 7: e2e + 최종 검증

**Files:**
- Modify: `e2e/mock-panel.mjs`, `README.md`
- Create: `e2e/subusers.spec.ts`

- [ ] **Step 1: mock 패널 확장**

`e2e/mock-panel.mjs`에 추가:
```js
if (p === '/api/client/servers/1a2b3c4d/users') return json({ object: 'list', data: [{ object: 'server_subuser', attributes: { uuid: 'sub-1', username: 'helper', email: 'helper@example.com', image: '', permissions: ['control.console', 'file.read'] } }] });
if (p === '/api/client/permissions') return json({ object: 'system_permissions', attributes: { permissions: { control: { description: '', keys: { console: '', start: '', stop: '' } }, file: { description: '', keys: { read: '', create: '' } } } } });
```

- [ ] **Step 2: e2e 스펙**

`e2e/subusers.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
async function login(page, id: string, pw: string) { await page.goto('/login'); await page.fill('input[name="identifier"]', id); await page.fill('input[name="password"]', pw); await page.click('button[type="submit"]'); await page.waitForURL('**/servers'); }

test('USER sees subusers', async ({ page }) => { await login(page, 'user', 'user-pass'); await page.goto('/servers/1a2b3c4d/subusers'); await expect(page.getByText('helper@example.com')).toBeVisible(); });
test('subusers tab on non-owned server is 404', async ({ page }) => { await login(page, 'user', 'user-pass'); const res = await page.goto('/servers/9z9z9z9z/subusers'); expect(res?.status()).toBe(404); });
test('admin sees scope sync button', async ({ page }) => { await login(page, 'admin', 'admin-pass'); await page.goto('/admin'); await expect(page.getByText('서브유저 접근 동기화')).toBeVisible(); });
```

- [ ] **Step 3: 전체 검증 + README**

`README.md`에 "서브유저(권한)·서브유저 스코프 동기화(관리자)" 반영. 서브유저 접근이 보이려면 관리자가 `/admin`에서 동기화를 한 번 실행해야 함을 명시.
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm prisma migrate deploy
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
```
Expected: 전부 그린.

- [ ] **Step 4: Commit + Push**

```bash
git add e2e/ README.md
git commit -m "test(e2e): subusers tab + admin sync button; README"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지:** 부록 A §3.8 Subusers(목록·초대·권한수정·제거) ✓T2,3,6 · §3.11 permissions ✓T2 · §4.6 스코프 확장(ServerAccess 캐시 + 동기화 + 소유∪서브유저) ✓T1,4,5 · §4 인가(서브유저 액션 guard·404; 동기화 requireAdmin) ✓T3,4 · §15 audit ✓T3,4.
- **보안:** 서브유저 액션 `guard()` 선행. 동기화 `assertAdmin`. 키 서버 전용. 스코프 확장은 캐시 행을 신뢰하되, 행은 admin 동기화로만 생성(유저 입력 아님). 소유는 항상 라이브 권위.
- **레이트리밋:** 동기화 O(서버수) 호출 → 주의 문서화·관리자 트리거(요청 경로 밖)·캐시 무효화. 대규모는 페이싱/주기화 후속.
- **플레이스홀더 스캔:** 모든 코드/명령 실측.
- **타입 일관성:** `Ok/Fail` 패턴 동일. `Subuser`·`ServerAccess`(Prisma)·`AccessibleServer` 정합. `resolveAccessibleServers` 반환형 불변(AccessibleServer[]), USER 분기만 확장. `invalidateAccessCache` 동기화 후 호출로 즉시 반영.
- **마이그레이션:** 가산적(`ServerAccess` 신규 테이블), 기존 스키마 불변.

---

## Phase 4 완료
Phase 4a(서버 상세)·4b(스케줄)·4c(서브유저+스코프)로 "나머지 클라이언트 + 서브유저"가 완성된다. 다음: **Phase 5**(마감·강화: 모니터링 대시보드·알림·i18n·테마·하드닝) → **Phase 6**(플러그인 시스템).
