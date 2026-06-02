# Pteron Panel — Admin: Users & Infrastructure 구현 계획 (Phase 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 영역의 기반을 만든다 — `requireAdmin` 가드 + 관리자 셸/내비, Application API 래퍼(유저·노드·로케이션·Nest/Egg), **Pteron 계정 관리(생성·매핑·수정·삭제)** 와 하부 Pterodactyl 유저 관리, 그리고 노드·로케이션 관리 UI.

**Architecture:** 기존 패턴 유지 — UI는 `src/server/*` Server Actions만 호출, 관리자 액션은 `requireAdmin()`로 가드한다. Application API 호출은 `src/lib/ptero/application.ts`에 모은다(숫자 id). **Pteron 계정(자체 DB) 관리는 Prisma**로, **하부 Pterodactyl 유저는 Application API**로 다루고, 둘을 `pteroUserId`로 매핑한다(`findUserByEmail` 재사용). 관리자 라우트는 `(panel)/admin/*` 아래 두고 레이아웃에서 `requireAdmin`.

**Tech Stack:** 기존 스택(Next 15·TS·Prisma·Tailwind·Vitest+MSW·Playwright). **선행:** 첫 슬라이스 + Phase 2 완료 — `pteroFetch`, `requireUser/requireAdmin`, `prisma`, `findUserByEmail`, `hashPassword`, UI 컴포넌트가 존재. 참조 spec: 부록 A §2(Application API), §8.2(온보딩/매핑), §4(인가), §15.

> **표준 규칙:** 각 Task commit + push(작업 브랜치). **AI 워터마크 금지.** 이 Phase는 **워크트리**에서 작업(브랜치 유지+push, main 병합+push, 워크트리 제거).

---

## File Structure (Phase 3a 범위)

| 파일 | 책임 |
|---|---|
| `src/lib/ptero/types.ts`(수정) | `PteroUser`, `PteroNode`, `PteroLocation`, `PteroNest`, `PteroEgg`, `PteroEggVariable` |
| `src/lib/ptero/application.ts`(수정) | 유저/노드/로케이션/Nest·Egg CRUD·조회 래퍼 |
| `src/lib/authz/admin.ts` | `requireAdminUser()` 헬퍼(서버액션용; redirect 아닌 throw) |
| `src/server/admin/users.ts` | Pteron 계정 + Pterodactyl 유저 관리 액션(requireAdmin) |
| `src/server/admin/infra.ts` | 노드/로케이션 액션(requireAdmin) |
| `src/app/(panel)/admin/layout.tsx` | 관리자 셸(requireAdmin) + 관리자 내비 |
| `src/app/(panel)/admin/page.tsx` | 관리자 개요(요약) |
| `src/app/(panel)/admin/users/page.tsx` + `src/features/admin/users/*` | 유저 관리 UI |
| `src/app/(panel)/admin/nodes/page.tsx`, `admin/locations/page.tsx` + `src/features/admin/infra/*` | 노드/로케이션 UI |
| `e2e/admin.spec.ts` | 관리자 접근/비관리자 차단 |

---

## Task 1: 관리자 가드 + 관리자 셸

**Files:**
- Create: `src/lib/authz/admin.ts`, `src/lib/authz/admin.test.ts`, `src/app/(panel)/admin/layout.tsx`, `src/app/(panel)/admin/page.tsx`

- [ ] **Step 1: 실패 테스트 작성 (서버액션용 admin 가드)**

`src/lib/authz/admin.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assertAdmin, AdminRequiredError } from './admin';

describe('assertAdmin', () => {
  it('passes for an ADMIN', () => {
    expect(() => assertAdmin({ id: 'a', role: 'ADMIN', pteroUserId: null })).not.toThrow();
  });
  it('throws AdminRequiredError for a USER', () => {
    expect(() => assertAdmin({ id: 'u', role: 'USER', pteroUserId: 1 })).toThrow(AdminRequiredError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/authz/admin.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`src/lib/authz/admin.ts`:
```ts
import type { User } from '@prisma/client';
import { requireUser } from '@/lib/auth/current-user';

export class AdminRequiredError extends Error {
  constructor() {
    super('Administrator access required.');
    this.name = 'AdminRequiredError';
  }
}

export function assertAdmin(user: Pick<User, 'id' | 'role' | 'pteroUserId'>): void {
  if (user.role !== 'ADMIN') throw new AdminRequiredError();
}

/** For Server Actions: returns the user or throws AdminRequiredError (mapped to a result by callers). */
export async function requireAdminUser(): Promise<User> {
  const user = await requireUser();
  assertAdmin(user);
  return user;
}
```

`src/app/(panel)/admin/layout.tsx`:
```tsx
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/current-user';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin(); // redirects non-admins to /servers
  return (
    <div>
      <nav className="mb-5 flex gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800 text-sm">
        <Link href="/admin" className="px-3 py-1.5 hover:text-indigo-600">개요</Link>
        <Link href="/admin/users" className="px-3 py-1.5 hover:text-indigo-600">유저</Link>
        <Link href="/admin/servers" className="px-3 py-1.5 hover:text-indigo-600">서버</Link>
        <Link href="/admin/nodes" className="px-3 py-1.5 hover:text-indigo-600">노드</Link>
        <Link href="/admin/locations" className="px-3 py-1.5 hover:text-indigo-600">로케이션</Link>
      </nav>
      {children}
    </div>
  );
}
```

`src/app/(panel)/admin/page.tsx`:
```tsx
export default function AdminHome() {
  return (
    <div>
      <h1 className="text-xl font-semibold">관리자</h1>
      <p className="mt-2 text-sm text-zinc-500">좌측/상단 메뉴에서 유저·서버·노드·로케이션을 관리하세요.</p>
    </div>
  );
}
```

> `/admin/servers`는 Plan 3b에서 추가. 지금은 링크만 존재(클릭 시 404 — 3b에서 해소).

- [ ] **Step 4: 통과 확인 + Commit + Push**

Run: `pnpm vitest run src/lib/authz/admin.test.ts && pnpm typecheck`
```bash
git add src/lib/authz/admin.ts src/lib/authz/admin.test.ts "src/app/(panel)/admin/layout.tsx" "src/app/(panel)/admin/page.tsx"
git commit -m "feat(admin): admin guard + admin shell layout"
git push
```

---

## Task 2: Application API — 유저 CRUD 래퍼 [TDD]

**Files:**
- Modify: `src/lib/ptero/types.ts`, `src/lib/ptero/application.ts`
- Create: `src/lib/ptero/application.users.test.ts`

- [ ] **Step 1: 타입 추가**

`src/lib/ptero/types.ts` 끝에:
```ts
export interface PteroUser {
  id: number;
  uuid: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  root_admin: boolean;
  created_at: string;
}

export interface CreatePteroUserInput {
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  password?: string;
  root_admin?: boolean;
  external_id?: string;
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/ptero/application.users.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listUsers, createUser, updateUser, deleteUser } from './application';

const BASE = 'https://panel.test/api/application';

const userAttrs = (over = {}) => ({ id: 1, uuid: 'u-1', username: 'bob', email: 'bob@x.com', first_name: 'Bob', last_name: 'B', root_admin: false, created_at: '', ...over });

describe('application users', () => {
  it('listUsers paginates and maps', async () => {
    mswServer.use(http.get(`${BASE}/users`, () => HttpResponse.json({ object: 'list', data: [{ object: 'user', attributes: userAttrs() }], meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } } })));
    const users = await listUsers();
    expect(users[0]).toMatchObject({ id: 1, email: 'bob@x.com' });
  });

  it('createUser posts mapped fields', async () => {
    let body: any;
    mswServer.use(http.post(`${BASE}/users`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'user', attributes: userAttrs({ id: 9 }) }); }));
    const u = await createUser({ email: 'a@b.com', username: 'a', first_name: 'A', last_name: 'B', password: 'pw' });
    expect(body).toMatchObject({ email: 'a@b.com', username: 'a', first_name: 'A', last_name: 'B', password: 'pw' });
    expect(u.id).toBe(9);
  });

  it('updateUser PATCHes', async () => {
    let body: any;
    mswServer.use(http.patch(`${BASE}/users/9`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'user', attributes: userAttrs({ id: 9, email: 'new@x.com' }) }); }));
    const u = await updateUser(9, { email: 'new@x.com' });
    expect(body).toEqual({ email: 'new@x.com' });
    expect(u.email).toBe('new@x.com');
  });

  it('deleteUser DELETEs', async () => {
    let called = false;
    mswServer.use(http.delete(`${BASE}/users/9`, () => { called = true; return new HttpResponse(null, { status: 204 }); }));
    await deleteUser(9);
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run src/lib/ptero/application.users.test.ts`
Expected: FAIL.

- [ ] **Step 4: 구현 추가**

`src/lib/ptero/application.ts`에 추가(상단 import에 `PteroUser`, `CreatePteroUserInput` 타입 추가):
```ts
export async function listUsers(): Promise<PteroUser[]> {
  const items = await paginateAll<PteroUser>((page) =>
    pteroFetch('application', '/users', { query: { page, per_page: 100 } }),
  );
  return items.map((i) => i.attributes);
}

export async function getUser(id: number): Promise<PteroUser> {
  const res = await pteroFetch<PteroItem<PteroUser>>('application', `/users/${id}`);
  return res.attributes;
}

export async function createUser(input: CreatePteroUserInput): Promise<PteroUser> {
  const res = await pteroFetch<PteroItem<PteroUser>>('application', '/users', { method: 'POST', body: input });
  return res.attributes;
}

export async function updateUser(id: number, input: Partial<CreatePteroUserInput>): Promise<PteroUser> {
  const res = await pteroFetch<PteroItem<PteroUser>>('application', `/users/${id}`, { method: 'PATCH', body: input });
  return res.attributes;
}

export async function deleteUser(id: number): Promise<void> {
  await pteroFetch('application', `/users/${id}`, { method: 'DELETE' });
}
```

> `paginateAll`/`PteroItem`/`pteroFetch`는 기존 import. 누락 시 추가.

- [ ] **Step 5: 통과 + Commit + Push**

Run: `pnpm vitest run src/lib/ptero/application.users.test.ts`
```bash
git add src/lib/ptero/types.ts src/lib/ptero/application.ts src/lib/ptero/application.users.test.ts
git commit -m "feat(ptero): application user CRUD wrappers"
git push
```

---

## Task 3: Application API — 노드/로케이션/Egg 래퍼 [TDD]

**Files:**
- Modify: `src/lib/ptero/types.ts`, `src/lib/ptero/application.ts`
- Create: `src/lib/ptero/application.infra.test.ts`

- [ ] **Step 1: 타입 추가**

`src/lib/ptero/types.ts` 끝에:
```ts
export interface PteroNode {
  id: number;
  name: string;
  fqdn: string;
  memory: number;
  memory_overallocate: number;
  disk: number;
  disk_overallocate: number;
  location_id: number;
  maintenance_mode: boolean;
}
export interface PteroLocation {
  id: number;
  short: string;
  long: string | null;
}
export interface PteroNest {
  id: number;
  name: string;
  description: string | null;
}
export interface PteroEggVariable {
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  rules: string;
  user_editable: boolean;
}
export interface PteroEgg {
  id: number;
  name: string;
  docker_image: string;
  startup: string;
  variables?: PteroEggVariable[];
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/ptero/application.infra.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listNodes, listLocations, createLocation, listEggs, getEgg } from './application';

const BASE = 'https://panel.test/api/application';

describe('application infra', () => {
  it('listNodes maps', async () => {
    mswServer.use(http.get(`${BASE}/nodes`, () => HttpResponse.json({ object: 'list', data: [{ object: 'node', attributes: { id: 1, name: 'n1', fqdn: 'n1.x', memory: 8192, memory_overallocate: 0, disk: 100000, disk_overallocate: 0, location_id: 1, maintenance_mode: false } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
    expect((await listNodes())[0]).toMatchObject({ id: 1, name: 'n1' });
  });

  it('listLocations + createLocation', async () => {
    mswServer.use(http.get(`${BASE}/locations`, () => HttpResponse.json({ object: 'list', data: [{ object: 'location', attributes: { id: 1, short: 'us', long: 'US' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
    expect((await listLocations())[0].short).toBe('us');
    let body: any;
    mswServer.use(http.post(`${BASE}/locations`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'location', attributes: { id: 2, short: 'eu', long: 'EU' } }); }));
    const loc = await createLocation({ short: 'eu', long: 'EU' });
    expect(body).toEqual({ short: 'eu', long: 'EU' });
    expect(loc.id).toBe(2);
  });

  it('listEggs + getEgg(variables)', async () => {
    mswServer.use(http.get(`${BASE}/nests/1/eggs`, () => HttpResponse.json({ object: 'list', data: [{ object: 'egg', attributes: { id: 5, name: 'Paper', docker_image: 'img', startup: 'java' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
    expect((await listEggs(1))[0].name).toBe('Paper');
    mswServer.use(http.get(`${BASE}/nests/1/eggs/5`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('include')).toBe('variables');
      return HttpResponse.json({ object: 'egg', attributes: { id: 5, name: 'Paper', docker_image: 'img', startup: 'java', relationships: { variables: { object: 'list', data: [{ object: 'egg_variable', attributes: { name: 'Version', description: '', env_variable: 'VERSION', default_value: 'latest', rules: 'required|string', user_editable: true } }] } } } });
    }));
    const egg = await getEgg(1, 5);
    expect(egg.variables?.[0].env_variable).toBe('VERSION');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run src/lib/ptero/application.infra.test.ts`
Expected: FAIL.

- [ ] **Step 4: 구현 추가**

`src/lib/ptero/application.ts`에 추가:
```ts
export async function listNodes(): Promise<PteroNode[]> {
  const items = await paginateAll<PteroNode>((page) => pteroFetch('application', '/nodes', { query: { page, per_page: 100 } }));
  return items.map((i) => i.attributes);
}
export async function getNode(id: number): Promise<PteroNode> {
  const res = await pteroFetch<PteroItem<PteroNode>>('application', `/nodes/${id}`);
  return res.attributes;
}

export async function listLocations(): Promise<PteroLocation[]> {
  const items = await paginateAll<PteroLocation>((page) => pteroFetch('application', '/locations', { query: { page, per_page: 100 } }));
  return items.map((i) => i.attributes);
}
export async function createLocation(input: { short: string; long?: string }): Promise<PteroLocation> {
  const res = await pteroFetch<PteroItem<PteroLocation>>('application', '/locations', { method: 'POST', body: input });
  return res.attributes;
}
export async function updateLocation(id: number, input: { short?: string; long?: string }): Promise<PteroLocation> {
  const res = await pteroFetch<PteroItem<PteroLocation>>('application', `/locations/${id}`, { method: 'PATCH', body: input });
  return res.attributes;
}
export async function deleteLocation(id: number): Promise<void> {
  await pteroFetch('application', `/locations/${id}`, { method: 'DELETE' });
}

export async function listNests(): Promise<PteroNest[]> {
  const items = await paginateAll<PteroNest>((page) => pteroFetch('application', '/nests', { query: { page, per_page: 100 } }));
  return items.map((i) => i.attributes);
}
export async function listEggs(nestId: number): Promise<PteroEgg[]> {
  const items = await paginateAll<PteroEgg>((page) => pteroFetch('application', `/nests/${nestId}/eggs`, { query: { page, per_page: 100 } }));
  return items.map((i) => i.attributes);
}
export async function getEgg(nestId: number, eggId: number): Promise<PteroEgg> {
  const res = await pteroFetch<PteroItem<PteroEgg & { relationships?: { variables?: PteroList<PteroEggVariable> } }>>('application', `/nests/${nestId}/eggs/${eggId}`, { query: { include: 'variables' } });
  const variables = res.attributes.relationships?.variables?.data.map((d) => d.attributes);
  return { id: res.attributes.id, name: res.attributes.name, docker_image: res.attributes.docker_image, startup: res.attributes.startup, variables };
}
```

- [ ] **Step 5: 통과 + Commit + Push**

```bash
git add src/lib/ptero/types.ts src/lib/ptero/application.ts src/lib/ptero/application.infra.test.ts
git commit -m "feat(ptero): application node/location/nest/egg wrappers"
git push
```

---

## Task 4: Pteron 계정 관리 액션 (Prisma + 매핑) [TDD]

**Files:**
- Create: `src/server/admin/users.ts`, `src/server/admin/users.test.ts`

> Pteron 계정은 자체 DB(Prisma). 생성 시 이메일로 Pterodactyl 유저를 찾아 `pteroUserId`/`pteroUuid` 매핑. requireAdmin 가드.

- [ ] **Step 1: 실패 테스트 작성 (가드 + 매핑)**

`src/server/admin/users.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

const prismaMock = {
  user: {
    findMany: vi.fn(async () => []),
    create: vi.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
    update: vi.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
    delete: vi.fn(async () => ({ id: 'p1' })),
  },
};
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

let currentUser: any = { id: 'admin', role: 'ADMIN', pteroUserId: null };
vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => currentUser) }));

import { listPteronUsersAction, createPteronUserAction } from './users';

const BASE = 'https://panel.test/api/application';
beforeEach(() => { currentUser = { id: 'admin', role: 'ADMIN', pteroUserId: null }; vi.clearAllMocks(); });

describe('admin user actions', () => {
  it('non-admin is rejected', async () => {
    currentUser = { id: 'u', role: 'USER', pteroUserId: 1 };
    const res = await listPteronUsersAction();
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('createPteronUser maps to a Pterodactyl user by email', async () => {
    mswServer.use(http.get(`${BASE}/users`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('filter[email]')).toBe('bob@x.com');
      return HttpResponse.json({ object: 'list', data: [{ object: 'user', attributes: { id: 7, uuid: 'u-7', email: 'bob@x.com' } }], meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } } });
    }));
    const res = await createPteronUserAction({ email: 'bob@x.com', username: 'bob', password: 'pw12345678', role: 'USER' });
    expect(res.ok).toBe(true);
    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pteroUserId: 7, pteroUuid: 'u-7', role: 'USER' }) }));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/server/admin/users.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`src/server/admin/users.ts`:
```ts
'use server';

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/current-user';
import { assertAdmin, AdminRequiredError } from '@/lib/authz/admin';
import { hashPassword } from '@/lib/auth/password';
import { findUserByEmail, createUser as createPteroUser, deleteUser as deletePteroUser } from '@/lib/ptero/application';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';

type Fail = { ok: false; error: 'forbidden' | 'failed' | 'validation'; detail?: string };
type Ok<T> = { ok: true } & T;

async function admin() {
  const user = await requireUser();
  assertAdmin(user);
  return user;
}
function fail(err: unknown): Fail {
  if (err instanceof AdminRequiredError) return { ok: false, error: 'forbidden' };
  if (err instanceof z.ZodError) return { ok: false, error: 'validation', detail: err.issues[0]?.message };
  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('admin user action failed', err);
  return { ok: false, error: 'failed', detail };
}

export interface PteronUserRow {
  id: string; email: string; username: string; role: 'ADMIN' | 'USER';
  isActive: boolean; pteroUserId: number | null;
}

export async function listPteronUsersAction(): Promise<Ok<{ users: PteronUserRow[] }> | Fail> {
  try {
    await admin();
    const rows = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return { ok: true, users: rows.map((r) => ({ id: r.id, email: r.email, username: r.username, role: r.role, isActive: r.isActive, pteroUserId: r.pteroUserId })) };
  } catch (err) { return fail(err); }
}

const CreateSchema = z.object({
  email: z.string().email(),
  username: z.string().min(1).max(191),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'USER']),
  createPterodactyl: z.boolean().optional(), // if true and no existing ptero user, create one
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export async function createPteronUserAction(input: z.infer<typeof CreateSchema>): Promise<Ok<{ id: string }> | Fail> {
  try {
    await admin();
    const data = CreateSchema.parse(input);
    let mapping = await findUserByEmail(data.email);
    if (!mapping && data.createPterodactyl) {
      const created = await createPteroUser({ email: data.email, username: data.username, first_name: data.firstName ?? data.username, last_name: data.lastName ?? '-' });
      mapping = { id: created.id, uuid: created.uuid };
    }
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        username: data.username,
        passwordHash: await hashPassword(data.password),
        role: data.role,
        pteroUserId: mapping?.id,
        pteroUuid: mapping?.uuid,
      },
    });
    await audit('admin.user.create', { userId: (await admin()).id, target: user.id, metadata: { role: data.role, mapped: Boolean(mapping) } });
    return { ok: true, id: user.id };
  } catch (err) { return fail(err); }
}

const UpdateSchema = z.object({
  id: z.string(),
  role: z.enum(['ADMIN', 'USER']).optional(),
  isActive: z.boolean().optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
});

export async function updatePteronUserAction(input: z.infer<typeof UpdateSchema>): Promise<Ok<{}> | Fail> {
  try {
    const me = await admin();
    const data = UpdateSchema.parse(input);
    const patch: Record<string, unknown> = {};
    if (data.role) patch.role = data.role;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.email) {
      patch.email = data.email.toLowerCase();
      const mapping = await findUserByEmail(data.email);
      patch.pteroUserId = mapping?.id ?? null;
      patch.pteroUuid = mapping?.uuid ?? null;
    }
    if (data.password) patch.passwordHash = await hashPassword(data.password);
    await prisma.user.update({ where: { id: data.id }, data: patch });
    await audit('admin.user.update', { userId: me.id, target: data.id, metadata: { fields: Object.keys(patch) } });
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function deletePteronUserAction(id: string, alsoDeletePterodactyl = false): Promise<Ok<{}> | Fail> {
  try {
    const me = await admin();
    if (id === me.id) return { ok: false, error: 'failed', detail: '자기 자신은 삭제할 수 없습니다.' };
    const target = await prisma.user.findUnique({ where: { id } });
    await prisma.user.delete({ where: { id } });
    if (alsoDeletePterodactyl && target?.pteroUserId) {
      await deletePteroUser(target.pteroUserId).catch((e) => console.error('ptero user delete failed', e));
    }
    await audit('admin.user.delete', { userId: me.id, target: id });
    return { ok: true };
  } catch (err) { return fail(err); }
}
```

- [ ] **Step 4: 통과 + Commit + Push**

Run: `pnpm vitest run src/server/admin/users.test.ts`
```bash
git add src/server/admin/users.ts src/server/admin/users.test.ts
git commit -m "feat(admin): Pteron account management actions (create/map/update/delete)"
git push
```

---

## Task 5: 노드/로케이션 관리 액션 [TDD]

**Files:**
- Create: `src/server/admin/infra.ts`, `src/server/admin/infra.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/server/admin/infra.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

let currentUser: any = { id: 'admin', role: 'ADMIN', pteroUserId: null };
vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => currentUser) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { listNodesAction, createLocationAction } from './infra';

const BASE = 'https://panel.test/api/application';
beforeEach(() => { currentUser = { id: 'admin', role: 'ADMIN', pteroUserId: null }; });

describe('admin infra actions', () => {
  it('non-admin rejected', async () => {
    currentUser = { id: 'u', role: 'USER', pteroUserId: 1 };
    expect(await listNodesAction()).toEqual({ ok: false, error: 'forbidden' });
  });
  it('listNodesAction returns nodes for admin', async () => {
    mswServer.use(http.get(`${BASE}/nodes`, () => HttpResponse.json({ object: 'list', data: [{ object: 'node', attributes: { id: 1, name: 'n1', fqdn: 'n1.x', memory: 1, memory_overallocate: 0, disk: 1, disk_overallocate: 0, location_id: 1, maintenance_mode: false } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
    const res = await listNodesAction();
    expect(res.ok && res.nodes[0].name).toBe('n1');
  });
  it('createLocationAction posts', async () => {
    let body: any;
    mswServer.use(http.post(`${BASE}/locations`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'location', attributes: { id: 3, short: 'kr', long: 'Korea' } }); }));
    const res = await createLocationAction({ short: 'kr', long: 'Korea' });
    expect(res.ok).toBe(true);
    expect(body).toEqual({ short: 'kr', long: 'Korea' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/server/admin/infra.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`src/server/admin/infra.ts`:
```ts
'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/current-user';
import { assertAdmin, AdminRequiredError } from '@/lib/authz/admin';
import * as app from '@/lib/ptero/application';
import type { PteroNode, PteroLocation } from '@/lib/ptero/types';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';

type Fail = { ok: false; error: 'forbidden' | 'failed' | 'validation'; detail?: string };
type Ok<T> = { ok: true } & T;

async function admin() { const u = await requireUser(); assertAdmin(u); return u; }
function fail(err: unknown): Fail {
  if (err instanceof AdminRequiredError) return { ok: false, error: 'forbidden' };
  if (err instanceof z.ZodError) return { ok: false, error: 'validation', detail: err.issues[0]?.message };
  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('admin infra action failed', err);
  return { ok: false, error: 'failed', detail };
}

export async function listNodesAction(): Promise<Ok<{ nodes: PteroNode[] }> | Fail> {
  try { await admin(); return { ok: true, nodes: await app.listNodes() }; } catch (err) { return fail(err); }
}
export async function listLocationsAction(): Promise<Ok<{ locations: PteroLocation[] }> | Fail> {
  try { await admin(); return { ok: true, locations: await app.listLocations() }; } catch (err) { return fail(err); }
}

const LocationSchema = z.object({ short: z.string().min(1).max(60), long: z.string().max(191).optional() });
export async function createLocationAction(input: z.infer<typeof LocationSchema>): Promise<Ok<{ id: number }> | Fail> {
  try { const me = await admin(); const data = LocationSchema.parse(input); const loc = await app.createLocation(data); await audit('admin.location.create', { userId: me.id, target: String(loc.id) }); return { ok: true, id: loc.id }; }
  catch (err) { return fail(err); }
}
export async function updateLocationAction(id: number, input: Partial<z.infer<typeof LocationSchema>>): Promise<Ok<{}> | Fail> {
  try { const me = await admin(); await app.updateLocation(id, input); await audit('admin.location.update', { userId: me.id, target: String(id) }); return { ok: true }; }
  catch (err) { return fail(err); }
}
export async function deleteLocationAction(id: number): Promise<Ok<{}> | Fail> {
  try { const me = await admin(); await app.deleteLocation(id); await audit('admin.location.delete', { userId: me.id, target: String(id) }); return { ok: true }; }
  catch (err) { return fail(err); }
}
```

- [ ] **Step 4: 통과 + Commit + Push**

```bash
git add src/server/admin/infra.ts src/server/admin/infra.test.ts
git commit -m "feat(admin): node/location management actions"
git push
```

---

## Task 6: 유저 관리 UI

**Files:**
- Create: `src/app/(panel)/admin/users/page.tsx`, `src/features/admin/users/users-manager.tsx`

- [ ] **Step 1: 유저 매니저(Client) 작성**

`src/features/admin/users/users-manager.tsx`:
```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { listPteronUsersAction, createPteronUserAction, updatePteronUserAction, deletePteronUserAction, type PteronUserRow } from '@/server/admin/users';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function UsersManager() {
  const [users, setUsers] = useState<PteronUserRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ email: '', username: '', password: '', role: 'USER', createPterodactyl: false });

  function load() {
    start(async () => {
      const res = await listPteronUsersAction();
      if (res.ok) setUsers(res.users); else setMsg(res.error === 'forbidden' ? '권한 없음' : (res.detail ?? '불러오기 실패'));
    });
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await createPteronUserAction({ ...form, role: form.role as 'ADMIN' | 'USER' });
    if (res.ok) { setForm({ email: '', username: '', password: '', role: 'USER', createPterodactyl: false }); load(); }
    else setMsg(res.detail ?? (res.error === 'validation' ? '입력값 확인' : '생성 실패'));
  }
  async function toggleActive(u: PteronUserRow) {
    const res = await updatePteronUserAction({ id: u.id, isActive: !u.isActive });
    if (res.ok) load(); else setMsg(res.detail ?? '수정 실패');
  }
  async function remove(u: PteronUserRow) {
    if (!confirm(`${u.email} 계정을 삭제할까요?`)) return;
    const res = await deletePteronUserAction(u.id);
    if (res.ok) load(); else setMsg(res.detail ?? '삭제 실패');
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">유저 관리</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <Card>
        <h2 className="mb-2 font-medium">새 Pteron 계정</h2>
        <form onSubmit={create} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Input placeholder="이메일" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="아이디" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <Input placeholder="비밀번호(8+)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="rounded-md border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <Button type="submit">생성</Button>
          <label className="col-span-2 flex items-center gap-2 text-xs text-zinc-500">
            <input type="checkbox" checked={form.createPterodactyl} onChange={(e) => setForm({ ...form, createPterodactyl: e.target.checked })} />
            매핑되는 Pterodactyl 유저가 없으면 새로 생성
          </label>
        </form>
      </Card>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500"><th className="px-4 py-2">이메일</th><th className="px-4 py-2">아이디</th><th className="px-4 py-2">역할</th><th className="px-4 py-2">매핑</th><th className="px-4 py-2">활성</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.username}</td>
                <td className="px-4 py-2">{u.role}</td>
                <td className="px-4 py-2 text-zinc-500">{u.pteroUserId ?? '미매핑'}</td>
                <td className="px-4 py-2">{u.isActive ? '✓' : '✗'}</td>
                <td className="px-4 py-2"><div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => toggleActive(u)}>{u.isActive ? '비활성' : '활성'}</Button>
                  <Button variant="ghost" onClick={() => remove(u)}>삭제</Button>
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

`src/app/(panel)/admin/users/page.tsx`:
```tsx
import { UsersManager } from '@/features/admin/users/users-manager';
export default function AdminUsersPage() {
  return <UsersManager />;
}
```

- [ ] **Step 3: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add "src/app/(panel)/admin/users/page.tsx" src/features/admin/users/
git commit -m "feat(admin): users management UI (list/create/map/toggle/delete)"
git push
```

---

## Task 7: 노드 · 로케이션 UI

**Files:**
- Create: `src/app/(panel)/admin/nodes/page.tsx`, `src/app/(panel)/admin/locations/page.tsx`, `src/features/admin/infra/nodes-view.tsx`, `src/features/admin/infra/locations-manager.tsx`

- [ ] **Step 1: 노드 뷰(읽기) 작성**

`src/features/admin/infra/nodes-view.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { listNodesAction } from '@/server/admin/infra';
import type { PteroNode } from '@/lib/ptero/types';
import { Card } from '@/components/ui/card';

export function NodesView() {
  const [nodes, setNodes] = useState<PteroNode[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { (async () => { const r = await listNodesAction(); if (r.ok) setNodes(r.nodes); else setMsg(r.detail ?? '불러오기 실패'); })(); }, []);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">노드</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card className="p-0">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500"><th className="px-4 py-2">이름</th><th className="px-4 py-2">FQDN</th><th className="px-4 py-2">메모리</th><th className="px-4 py-2">디스크</th><th className="px-4 py-2">점검</th></tr></thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2">{n.name}</td>
                <td className="px-4 py-2 text-zinc-500">{n.fqdn}</td>
                <td className="px-4 py-2">{n.memory} MB</td>
                <td className="px-4 py-2">{n.disk} MB</td>
                <td className="px-4 py-2">{n.maintenance_mode ? '점검중' : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 로케이션 매니저 작성**

`src/features/admin/infra/locations-manager.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { listLocationsAction, createLocationAction, deleteLocationAction } from '@/server/admin/infra';
import type { PteroLocation } from '@/lib/ptero/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function LocationsManager() {
  const [locations, setLocations] = useState<PteroLocation[]>([]);
  const [form, setForm] = useState({ short: '', long: '' });
  const [msg, setMsg] = useState<string | null>(null);

  async function load() { const r = await listLocationsAction(); if (r.ok) setLocations(r.locations); else setMsg(r.detail ?? '불러오기 실패'); }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const r = await createLocationAction({ short: form.short, long: form.long || undefined });
    if (r.ok) { setForm({ short: '', long: '' }); load(); } else setMsg(r.detail ?? '생성 실패');
  }
  async function remove(id: number) { if (!confirm('삭제할까요?')) return; const r = await deleteLocationAction(id); if (r.ok) load(); else setMsg(r.detail ?? '삭제 실패'); }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">로케이션</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card>
        <form onSubmit={create} className="flex gap-2">
          <Input placeholder="short (예: kr)" value={form.short} onChange={(e) => setForm({ ...form, short: e.target.value })} />
          <Input placeholder="long (설명)" value={form.long} onChange={(e) => setForm({ ...form, long: e.target.value })} />
          <Button type="submit">추가</Button>
        </form>
      </Card>
      <Card className="p-0">
        <table className="w-full text-sm">
          <tbody>
            {locations.map((l) => (
              <tr key={l.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2 font-medium">{l.short}</td>
                <td className="px-4 py-2 text-zinc-500">{l.long}</td>
                <td className="px-4 py-2 text-right"><Button variant="ghost" onClick={() => remove(l.id)}>삭제</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: 페이지 작성**

`src/app/(panel)/admin/nodes/page.tsx`:
```tsx
import { NodesView } from '@/features/admin/infra/nodes-view';
export default function AdminNodesPage() { return <NodesView />; }
```
`src/app/(panel)/admin/locations/page.tsx`:
```tsx
import { LocationsManager } from '@/features/admin/infra/locations-manager';
export default function AdminLocationsPage() { return <LocationsManager />; }
```

- [ ] **Step 4: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add "src/app/(panel)/admin/nodes/page.tsx" "src/app/(panel)/admin/locations/page.tsx" src/features/admin/infra/
git commit -m "feat(admin): nodes (read) + locations (CRUD) UI"
git push
```

---

## Task 8: e2e (관리자 접근 / 비관리자 차단) + 검증

**Files:**
- Modify: `e2e/mock-panel.mjs` (application users/nodes/locations 엔드포인트)
- Create: `e2e/admin.spec.ts`

- [ ] **Step 1: mock 패널에 Application 엔드포인트 추가**

`e2e/mock-panel.mjs`에 추가:
```js
if (p === '/api/application/users') {
  return json({ object: 'list', data: [{ object: 'user', attributes: { id: 7, uuid: 'u-7', username: 'user', email: 'user@example.com', first_name: 'U', last_name: 'Ser', root_admin: false, created_at: '' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } });
}
if (p === '/api/application/nodes') {
  return json({ object: 'list', data: [{ object: 'node', attributes: { id: 1, name: 'node-01', fqdn: 'node01.example.com', memory: 16384, memory_overallocate: 0, disk: 500000, disk_overallocate: 0, location_id: 1, maintenance_mode: false } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } });
}
if (p === '/api/application/locations') {
  return json({ object: 'list', data: [{ object: 'location', attributes: { id: 1, short: 'kr', long: 'Korea' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } });
}
```

- [ ] **Step 2: e2e 스펙 작성**

`e2e/admin.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

async function login(page, id: string, pw: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="password"]', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

test('admin can open users management', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin/users');
  await expect(page.getByText('유저 관리')).toBeVisible();
});

test('admin can view nodes', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin/nodes');
  await expect(page.getByText('node-01')).toBeVisible();
});

test('non-admin is redirected away from /admin', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/admin/users');
  await page.waitForURL('**/servers'); // requireAdmin redirects USER to /servers
  await expect(page.getByText('유저 관리')).toHaveCount(0);
});
```

- [ ] **Step 3: 전체 검증**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
```
Expected: 전부 그린(신규 application/admin 단위 테스트 + admin e2e 3종).

- [ ] **Step 4: Commit + Push**

```bash
git add e2e/
git commit -m "test(e2e): admin access + non-admin redirect"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지:** 부록 A §2 Application(users CRUD ✓T2 / nodes·locations·nests·eggs ✓T3) · §8.2 매핑(findUserByEmail로 pteroUserId 연결 ✓T4) · §4 인가(모든 admin 액션 `assertAdmin`, 페이지 `requireAdmin`, 비관리자 redirect ✓T1,4,5,8) · §15 audit(유저/로케이션 mutation ✓T4,5).
- **보안:** 모든 관리자 액션이 `admin()`(requireUser→assertAdmin) 선행. 키는 서버 전용(application.ts만 호출). 자기 자신 삭제 방지(T4).
- **플레이스홀더 스캔:** 모든 코드/명령 실측. `/admin/servers` 링크는 Plan 3b에서 채움(명시).
- **타입 일관성:** admin 액션 결과 `Ok<T> | Fail`('forbidden'/'failed'/'validation')가 기존 패턴과 정합. `PteroUser/PteroNode/PteroLocation/PteroEgg` 타입을 wrappers·actions·UI가 공유. `paginateAll`·`PteroItem`·`findUserByEmail` 재사용.
- **환경 의존:** 단위(MSW + Prisma mock, 패널·DB 불필요) / e2e(mock 패널 + 시드 DB).

---

## 다음
Plan 3b(서버 생성 마법사 + 관리자 서버 관리)로 이어진다. 이후 Phase 4(서브유저 등) → 5 → 6(플러그인).
