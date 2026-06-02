# Pteron Panel — Schedules 구현 계획 (Phase 4b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 서버 뷰에 **스케줄** 탭을 추가한다 — 스케줄 목록·생성·활성토글·즉시실행·삭제, 그리고 스케줄 안의 **태스크**(command/power/backup) 생성·수정·삭제.

**Architecture:** files/backups/server-detail와 동일 패턴 — Client API 래퍼(`src/lib/ptero/client.ts`) → 가드된 Server Action(`src/server/schedules.ts`, requireUser→requireServerAccess) → 서버 뷰 탭(`src/registry/server-tabs.ts`에 `schedules` 추가). 태스크는 스케줄의 `relationships.tasks`로 임베드되어 오므로 별도 목록 호출 없이 스케줄과 함께 로드한다.

**Tech Stack:** 기존 스택. **선행:** Phase 4a 완료. 참조 spec: 부록 A의 Client API Schedules 섹션(§3.6 Schedules & Tasks), §4 인가.

> **표준 규칙:** 각 Task commit + push(작업 브랜치). **AI 워터마크 금지.** **워크트리**에서 작업.

---

## File Structure (Phase 4b 범위)

| 파일 | 책임 |
|---|---|
| `src/lib/ptero/types.ts`(수정) | `ServerSchedule`, `ScheduleTask`, 입력 타입 |
| `src/lib/ptero/client.ts`(수정) | 스케줄/태스크 래퍼 |
| `src/server/schedules.ts` | 가드된 스케줄/태스크 액션 |
| `src/registry/server-tabs.ts`(수정) | `schedules` 탭 |
| `src/app/(panel)/servers/[id]/schedules/page.tsx` + `src/features/schedules/schedules-view.tsx` | UI |
| `e2e/*`(수정) | mock 확장 + e2e |

---

## Task 1: 스케줄/태스크 클라이언트 래퍼 + 타입 [TDD]

**Files:**
- Modify: `src/lib/ptero/types.ts`, `src/lib/ptero/client.ts`
- Create: `src/lib/ptero/client.schedules.test.ts`

- [ ] **Step 1: 타입 추가**

`src/lib/ptero/types.ts` 끝에:
```ts
export interface ScheduleTask {
  id: number;
  sequence_id: number;
  action: 'command' | 'power' | 'backup';
  payload: string;
  time_offset: number;
  is_queued: boolean;
  continue_on_failure: boolean;
}
export interface ServerSchedule {
  id: number;
  name: string;
  cron: { minute: string; hour: string; day_of_week: string; day_of_month: string; month: string };
  is_active: boolean;
  is_processing: boolean;
  only_when_online: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  tasks: ScheduleTask[];
}
export interface ScheduleInput {
  name: string;
  minute: string; hour: string; day_of_month: string; month: string; day_of_week: string;
  is_active?: boolean;
  only_when_online?: boolean;
}
export interface TaskInput {
  action: 'command' | 'power' | 'backup';
  payload: string;
  time_offset: number;
  continue_on_failure?: boolean;
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/ptero/client.schedules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listSchedules, createSchedule, executeSchedule, deleteSchedule, createTask, deleteTask } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');
const schedAttrs = (over = {}) => ({ id: 10, name: 'nightly', cron: { minute: '0', hour: '4', day_of_week: '*', day_of_month: '*', month: '*' }, is_active: true, is_processing: false, only_when_online: false, last_run_at: null, next_run_at: null, relationships: { tasks: { object: 'list', data: [{ object: 'schedule_task', attributes: { id: 1, sequence_id: 1, action: 'backup', payload: '', time_offset: 0, is_queued: false, continue_on_failure: false } }] } }, ...over });

describe('client schedules', () => {
  it('listSchedules maps with embedded tasks', async () => {
    mswServer.use(http.get(`${BASE}/servers/1a2b3c4d/schedules`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server_schedule', attributes: schedAttrs() }] })));
    const s = await listSchedules(id);
    expect(s[0]).toMatchObject({ id: 10, name: 'nightly', is_active: true });
    expect(s[0].tasks[0]).toMatchObject({ action: 'backup', sequence_id: 1 });
  });
  it('createSchedule posts cron fields', async () => {
    let body: any;
    mswServer.use(http.post(`${BASE}/servers/1a2b3c4d/schedules`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'server_schedule', attributes: schedAttrs({ id: 11 }) }); }));
    await createSchedule(id, { name: 'n', minute: '0', hour: '4', day_of_month: '*', month: '*', day_of_week: '*', is_active: true });
    expect(body).toMatchObject({ name: 'n', minute: '0', hour: '4', is_active: true });
  });
  it('executeSchedule + deleteSchedule', async () => {
    let exec = false, del = false;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/schedules/10/execute`, () => { exec = true; return new HttpResponse(null, { status: 202 }); }),
      http.delete(`${BASE}/servers/1a2b3c4d/schedules/10`, () => { del = true; return new HttpResponse(null, { status: 204 }); }),
    );
    await executeSchedule(id, 10); await deleteSchedule(id, 10);
    expect([exec, del]).toEqual([true, true]);
  });
  it('createTask + deleteTask', async () => {
    let body: any, delTask = false;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/schedules/10/tasks`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'schedule_task', attributes: { id: 2, sequence_id: 2, action: 'command', payload: 'say hi', time_offset: 5, is_queued: false, continue_on_failure: false } }); }),
      http.delete(`${BASE}/servers/1a2b3c4d/schedules/10/tasks/2`, () => { delTask = true; return new HttpResponse(null, { status: 204 }); }),
    );
    await createTask(id, 10, { action: 'command', payload: 'say hi', time_offset: 5 });
    await deleteTask(id, 10, 2);
    expect(body).toMatchObject({ action: 'command', payload: 'say hi', time_offset: 5 });
    expect(delTask).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인 → 구현**

`src/lib/ptero/client.ts`에 추가(상단 import에 `ServerSchedule, ScheduleTask, ScheduleInput, TaskInput` 추가; 경로 세그먼트는 기존 `pathSegment` 헬퍼 사용):
```ts
interface SchedAttrs {
  id: number; name: string;
  cron: ServerSchedule['cron'];
  is_active: boolean; is_processing: boolean; only_when_online: boolean;
  last_run_at: string | null; next_run_at: string | null;
  relationships?: { tasks?: { data: { attributes: ScheduleTask }[] } };
}
function mapSchedule(a: SchedAttrs): ServerSchedule {
  return { id: a.id, name: a.name, cron: a.cron, is_active: a.is_active, is_processing: a.is_processing, only_when_online: a.only_when_online, last_run_at: a.last_run_at, next_run_at: a.next_run_at, tasks: (a.relationships?.tasks?.data ?? []).map((t) => t.attributes) };
}
export async function listSchedules(id: ServerIdentifier): Promise<ServerSchedule[]> {
  const res = await pteroFetch<PteroList<SchedAttrs>>('client', `/servers/${id}/schedules`, { query: { include: 'tasks' } });
  return res.data.map((d) => mapSchedule(d.attributes));
}
export async function createSchedule(id: ServerIdentifier, input: ScheduleInput): Promise<ServerSchedule> {
  const res = await pteroFetch<PteroItem<SchedAttrs>>('client', `/servers/${id}/schedules`, { method: 'POST', body: input });
  return mapSchedule(res.attributes);
}
export async function updateSchedule(id: ServerIdentifier, schedId: number, input: ScheduleInput): Promise<ServerSchedule> {
  const res = await pteroFetch<PteroItem<SchedAttrs>>('client', `/servers/${id}/schedules/${pathSegment(String(schedId))}`, { method: 'POST', body: input });
  return mapSchedule(res.attributes);
}
export async function deleteSchedule(id: ServerIdentifier, schedId: number): Promise<void> {
  await pteroFetch('client', `/servers/${id}/schedules/${pathSegment(String(schedId))}`, { method: 'DELETE' });
}
export async function executeSchedule(id: ServerIdentifier, schedId: number): Promise<void> {
  await pteroFetch('client', `/servers/${id}/schedules/${pathSegment(String(schedId))}/execute`, { method: 'POST' });
}
export async function createTask(id: ServerIdentifier, schedId: number, input: TaskInput): Promise<ScheduleTask> {
  const res = await pteroFetch<PteroItem<ScheduleTask>>('client', `/servers/${id}/schedules/${pathSegment(String(schedId))}/tasks`, { method: 'POST', body: input });
  return res.attributes;
}
export async function updateTask(id: ServerIdentifier, schedId: number, taskId: number, input: TaskInput): Promise<ScheduleTask> {
  const res = await pteroFetch<PteroItem<ScheduleTask>>('client', `/servers/${id}/schedules/${pathSegment(String(schedId))}/tasks/${pathSegment(String(taskId))}`, { method: 'POST', body: input });
  return res.attributes;
}
export async function deleteTask(id: ServerIdentifier, schedId: number, taskId: number): Promise<void> {
  await pteroFetch('client', `/servers/${id}/schedules/${pathSegment(String(schedId))}/tasks/${pathSegment(String(taskId))}`, { method: 'DELETE' });
}
```
> `pathSegment` 헬퍼가 없으면(Phase 4a에서 추가됨) 숫자 id는 `String(schedId)` 직접 사용해도 안전(숫자라 인코딩 불필요).

Run: `pnpm vitest run src/lib/ptero/client.schedules.test.ts` → PASS.

- [ ] **Step 4: Commit + Push**

```bash
git add src/lib/ptero/types.ts src/lib/ptero/client.ts src/lib/ptero/client.schedules.test.ts
git commit -m "feat(ptero): client schedule + task endpoints"
git push
```

---

## Task 2: 스케줄 Server Actions (가드) [TDD]

**Files:**
- Create: `src/server/schedules.ts`, `src/server/schedules.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (가드)**

`src/server/schedules.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null })) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { listSchedulesAction, createScheduleAction } from './schedules';

const CLIENT = 'https://panel.test/api/client';
beforeEach(() => invalidateAccessCache());
function adminLists(idf: string) { mswServer.use(http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: { identifier: idf, uuid: `${idf}-0000-4000-8000-000000000000`, name: 'S' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } }))); }

describe('schedule actions', () => {
  it('lists for accessible server', async () => {
    adminLists('1a2b3c4d');
    mswServer.use(http.get(`${CLIENT}/servers/1a2b3c4d/schedules`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server_schedule', attributes: { id: 10, name: 'n', cron: { minute: '0', hour: '4', day_of_week: '*', day_of_month: '*', month: '*' }, is_active: true, is_processing: false, only_when_online: false, last_run_at: null, next_run_at: null } }] })));
    const res = await listSchedulesAction('1a2b3c4d');
    expect(res.ok && res.schedules[0].id).toBe(10);
  });
  it('not_found for inaccessible', async () => {
    adminLists('1a2b3c4d');
    expect(await listSchedulesAction('deadbeef')).toEqual({ ok: false, error: 'not_found' });
  });
  it('createSchedule validates cron presence', async () => {
    adminLists('1a2b3c4d');
    const res = await createScheduleAction('1a2b3c4d', { name: '', minute: '', hour: '', day_of_month: '', month: '', day_of_week: '' });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/server/schedules.ts`:
```ts
'use server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier, type ServerSchedule, type ScheduleTask } from '@/lib/ptero/types';
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
  console.error('schedule action failed', err);
  return { ok: false, error: 'failed', detail };
}

const cronField = z.string().min(1).max(8);
const ScheduleSchema = z.object({ name: z.string().min(1).max(191), minute: cronField, hour: cronField, day_of_month: cronField, month: cronField, day_of_week: cronField, is_active: z.boolean().optional(), only_when_online: z.boolean().optional() });
const TaskSchema = z.object({ action: z.enum(['command', 'power', 'backup']), payload: z.string(), time_offset: z.number().int().min(0).max(900), continue_on_failure: z.boolean().optional() });

export async function listSchedulesAction(identifier: string): Promise<Ok<{ schedules: ServerSchedule[] }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, schedules: await ptero.listSchedules(id) }; } catch (err) { return toFail(err); }
}
export async function createScheduleAction(identifier: string, input: z.infer<typeof ScheduleSchema>): Promise<Ok<{ schedule: ServerSchedule }> | Fail> {
  try { const { user, id } = await guard(identifier); const data = ScheduleSchema.parse(input); const s = await ptero.createSchedule(id, data); await audit('schedule.create', { userId: user.id, target: id, metadata: { name: data.name } }); return { ok: true, schedule: s }; } catch (err) { return toFail(err); }
}
export async function updateScheduleAction(identifier: string, schedId: number, input: z.infer<typeof ScheduleSchema>): Promise<Ok<{ schedule: ServerSchedule }> | Fail> {
  try { const { id } = await guard(identifier); const data = ScheduleSchema.parse(input); return { ok: true, schedule: await ptero.updateSchedule(id, schedId, data) }; } catch (err) { return toFail(err); }
}
export async function executeScheduleAction(identifier: string, schedId: number): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.executeSchedule(id, schedId); await audit('schedule.execute', { userId: user.id, target: id, metadata: { schedId } }); return { ok: true }; } catch (err) { return toFail(err); }
}
export async function deleteScheduleAction(identifier: string, schedId: number): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.deleteSchedule(id, schedId); await audit('schedule.delete', { userId: user.id, target: id, metadata: { schedId } }); return { ok: true }; } catch (err) { return toFail(err); }
}
export async function createTaskAction(identifier: string, schedId: number, input: z.infer<typeof TaskSchema>): Promise<Ok<{ task: ScheduleTask }> | Fail> {
  try { const { id } = await guard(identifier); const data = TaskSchema.parse(input); return { ok: true, task: await ptero.createTask(id, schedId, data) }; } catch (err) { return toFail(err); }
}
export async function deleteTaskAction(identifier: string, schedId: number, taskId: number): Promise<Ok<{}> | Fail> {
  try { const { id } = await guard(identifier); await ptero.deleteTask(id, schedId, taskId); return { ok: true }; } catch (err) { return toFail(err); }
}
```

Run: `pnpm vitest run src/server/schedules.test.ts` → PASS.

- [ ] **Step 3: Commit + Push**

```bash
git add src/server/schedules.ts src/server/schedules.test.ts
git commit -m "feat(server): guarded schedule + task actions"
git push
```

---

## Task 3: 스케줄 UI (탭 등록)

**Files:**
- Modify: `src/registry/server-tabs.ts`, `src/registry/server-tabs.test.ts`
- Create: `src/features/schedules/schedules-view.tsx`, `src/app/(panel)/servers/[id]/schedules/page.tsx`

- [ ] **Step 1: 탭 추가 + 테스트 갱신**

`src/registry/server-tabs.ts`의 `serverTabs`에 추가(activity 앞 등 적당한 위치):
```ts
{ key: 'schedules', label: '스케줄', href: (id) => `/servers/${id}/schedules` },
```
`server-tabs.test.ts` built-in 검사에 `'schedules'` 포함.

- [ ] **Step 2: 스케줄 뷰 작성**

`src/features/schedules/schedules-view.tsx`:
```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { listSchedulesAction, createScheduleAction, executeScheduleAction, deleteScheduleAction, createTaskAction, deleteTaskAction } from '@/server/schedules';
import type { ServerSchedule } from '@/lib/ptero/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const emptyCron = { name: '', minute: '0', hour: '*', day_of_month: '*', month: '*', day_of_week: '*' };

export function SchedulesView({ identifier }: { identifier: string }) {
  const [schedules, setSchedules] = useState<ServerSchedule[]>([]);
  const [form, setForm] = useState(emptyCron);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() { start(async () => { const r = await listSchedulesAction(identifier); if (r.ok) setSchedules(r.schedules); else setMsg(r.error === 'not_found' ? '서버를 찾을 수 없습니다.' : (r.detail ?? '실패')); }); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [identifier]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const r = await createScheduleAction(identifier, { ...form, is_active: true });
    if (r.ok) { setForm(emptyCron); load(); } else setMsg(r.detail ?? (r.error === 'validation' ? '입력값을 확인하세요.' : '생성 실패'));
  }
  async function execute(s: ServerSchedule) { const r = await executeScheduleAction(identifier, s.id); setMsg(r.ok ? '실행을 시작했습니다.' : (r.detail ?? '실패')); }
  async function remove(s: ServerSchedule) { if (!confirm(`${s.name} 삭제?`)) return; const r = await deleteScheduleAction(identifier, s.id); if (r.ok) load(); else setMsg(r.detail ?? '실패'); }
  async function addTask(s: ServerSchedule) {
    const payload = prompt('명령어 태스크 payload (예: say hi)');
    if (payload === null) return;
    const r = await createTaskAction(identifier, s.id, { action: 'command', payload, time_offset: 0 });
    if (r.ok) load(); else setMsg(r.detail ?? '태스크 추가 실패');
  }
  async function removeTask(s: ServerSchedule, taskId: number) { const r = await deleteTaskAction(identifier, s.id, taskId); if (r.ok) load(); else setMsg(r.detail ?? '실패'); }

  return (
    <div className="space-y-3">
      <h2 className="font-medium">스케줄</h2>
      {msg && <p className="text-sm text-zinc-500">{msg}</p>}
      <Card>
        <h3 className="mb-2 text-sm font-medium">새 스케줄 (cron)</h3>
        <form onSubmit={create} className="grid grid-cols-2 gap-2 sm:grid-cols-7">
          <Input placeholder="이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="분" value={form.minute} onChange={(e) => setForm({ ...form, minute: e.target.value })} />
          <Input placeholder="시" value={form.hour} onChange={(e) => setForm({ ...form, hour: e.target.value })} />
          <Input placeholder="일" value={form.day_of_month} onChange={(e) => setForm({ ...form, day_of_month: e.target.value })} />
          <Input placeholder="월" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
          <Input placeholder="요일" value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: e.target.value })} />
          <Button type="submit">생성</Button>
        </form>
      </Card>
      {schedules.map((s) => (
        <Card key={s.id} className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">{s.name}</span>
              <span className="ml-2 text-xs text-zinc-500">{s.cron.minute} {s.cron.hour} {s.cron.day_of_month} {s.cron.month} {s.cron.day_of_week}</span>
              {!s.is_active && <span className="ml-2 text-xs text-zinc-400">(비활성)</span>}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => execute(s)}>지금 실행</Button>
              <Button variant="ghost" onClick={() => addTask(s)}>태스크 추가</Button>
              <Button variant="ghost" onClick={() => remove(s)}>삭제</Button>
            </div>
          </div>
          <ul className="space-y-1 text-sm">
            {s.tasks.sort((a, b) => a.sequence_id - b.sequence_id).map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800">
                <span>#{t.sequence_id} {t.action}: <code className="text-xs">{t.payload}</code> (+{t.time_offset}s)</span>
                <Button variant="ghost" onClick={() => removeTask(s, t.id)}>삭제</Button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {pending && <p className="text-xs text-zinc-400">불러오는 중…</p>}
    </div>
  );
}
```

- [ ] **Step 3: 페이지 작성**

`src/app/(panel)/servers/[id]/schedules/page.tsx`:
```tsx
import { SchedulesView } from '@/features/schedules/schedules-view';
export default async function SchedulesPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <SchedulesView identifier={id} />; }
```

- [ ] **Step 4: 타입체크 + Commit + Push**

```bash
pnpm vitest run src/registry/server-tabs.test.ts && pnpm typecheck
git add src/registry/ src/features/schedules/ "src/app/(panel)/servers/[id]/schedules/page.tsx"
git commit -m "feat(ui): schedules server tab (schedules + tasks)"
git push
```

---

## Task 4: e2e + 최종 검증

**Files:**
- Modify: `e2e/mock-panel.mjs`, `README.md`
- Create: `e2e/schedules.spec.ts`

- [ ] **Step 1: mock 패널 확장**

`e2e/mock-panel.mjs`에 추가:
```js
if (p === '/api/client/servers/1a2b3c4d/schedules') {
  return json({ object: 'list', data: [{ object: 'server_schedule', attributes: { id: 10, name: 'Nightly Backup', cron: { minute: '0', hour: '4', day_of_week: '*', day_of_month: '*', month: '*' }, is_active: true, is_processing: false, only_when_online: false, last_run_at: null, next_run_at: null, relationships: { tasks: { object: 'list', data: [{ object: 'schedule_task', attributes: { id: 1, sequence_id: 1, action: 'backup', payload: '', time_offset: 0, is_queued: false, continue_on_failure: false } }] } } } }] });
}
```

- [ ] **Step 2: e2e 스펙**

`e2e/schedules.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
async function login(page, id: string, pw: string) { await page.goto('/login'); await page.fill('input[name="identifier"]', id); await page.fill('input[name="password"]', pw); await page.click('button[type="submit"]'); await page.waitForURL('**/servers'); }

test('USER sees schedules', async ({ page }) => { await login(page, 'user', 'user-pass'); await page.goto('/servers/1a2b3c4d/schedules'); await expect(page.getByText('Nightly Backup')).toBeVisible(); });
test('schedules tab on non-owned server is 404', async ({ page }) => { await login(page, 'user', 'user-pass'); const res = await page.goto('/servers/9z9z9z9z/schedules'); expect(res?.status()).toBe(404); });
```

- [ ] **Step 3: 전체 검증 + README**

`README.md` 기능 목록에 "스케줄(태스크)" 반영.
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
```
Expected: 전부 그린.

- [ ] **Step 4: Commit + Push**

```bash
git add e2e/ README.md
git commit -m "test(e2e): schedules tab + README"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지:** Client Schedules(목록 with tasks·생성·수정·실행·삭제) ✓T1,2 · Tasks(생성·삭제) ✓T1,2 · §4 인가(모든 액션 guard·404) ✓T2,4 · 탭 레지스트리 ✓T3.
- **보안:** 모든 액션 `guard()` 선행. 키 서버 전용. cron/태스크 입력 zod 검증. 삭제 확인(UI).
- **플레이스홀더 스캔:** 모든 코드/명령 실측.
- **타입 일관성:** `Ok/Fail` 패턴 동일. `ServerSchedule/ScheduleTask/ScheduleInput/TaskInput` 공유. `pathSegment`(4a) 재사용(숫자 id는 안전). `serverTabs` 확장이 layout과 호환.
- **범위:** 태스크는 command 추가만 UI로(간단). power/backup 태스크·태스크 수정은 후속 강화 여지(액션·래퍼는 이미 지원).

---

## 다음
Plan 4c(서브유저 + `ServerAccess` 캐시 스코프 확장)로 이어진다. 이후 Phase 5(마감) → Phase 6(플러그인).
