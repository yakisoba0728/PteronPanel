# Pteron Panel — Files & Backups 구현 계획 (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 첫 슬라이스(기반+콘솔) 위에 **파일 매니저**(목록·편집·업/다운로드·이동·복사·압축·해제·삭제·폴더생성·권한·원격풀)와 **백업**(목록·생성·다운로드·복원·삭제·잠금)을 얹는다. 둘 다 서버 뷰의 새 탭으로 추가한다.

**Architecture:** 기존 패턴을 그대로 따른다 — UI는 `src/server/*` Server Actions만 호출하고, 각 액션은 `requireUser()` → `requireServerAccess()`로 가드한 뒤 `src/lib/ptero/client.ts` 래퍼를 호출한다. 파일 **업로드/다운로드와 백업 다운로드**는 Client API가 발급하는 **서명된 1회성 URL**을 받아 브라우저가 Wings에 직접 요청한다(키 노출 없음, 대용량 스트리밍). 서버 뷰 탭은 기존 **탭 레지스트리**(`src/registry/server-tabs.ts`)에 `files`·`backups`를 추가한다.

**Tech Stack:** 기존 스택 그대로(Next 15·TS·Prisma·Tailwind·Vitest+MSW·Playwright). **선행:** 첫 슬라이스(Plan 1·2·3) 완료 — `pteroFetch`, `requireServerAccess`, `asIdentifier`, `AccessibleServer`, `serverTabs`, UI 컴포넌트가 존재해야 한다. 참조 spec: 부록 A §3.3(Files)·§3.4(Backups), §9 클라이언트 레이어, §4 인가.

> **표준 작업 규칙:** 각 Task 마지막에 commit + `git push`(현재 작업 브랜치). **AI 워터마크 금지.** 이 Phase는 **워크트리에서** 작업한다(새 브랜치 → 완료 시 push → main 병합·push → 워크트리 제거, 브랜치 유지).

---

## File Structure (Phase 2 범위)

| 파일 | 책임 |
|---|---|
| `src/lib/ptero/http.ts`(수정) | 원시(raw) 응답·바디 지원: `pteroFetchText`, `rawBody`/`contentType` |
| `src/lib/ptero/types.ts`(수정) | `FileEntry`, `BackupEntry`, 관련 타입 |
| `src/lib/ptero/client.ts`(수정) | 파일·백업 엔드포인트 래퍼 |
| `src/server/files.ts` | 파일 Server Actions(가드 포함) |
| `src/server/backups.ts` | 백업 Server Actions(가드 포함) |
| `src/registry/server-tabs.ts`(수정) | `files`·`backups` 탭 추가 |
| `src/app/(panel)/servers/[id]/files/page.tsx` | 파일 브라우저 |
| `src/app/(panel)/servers/[id]/files/edit/page.tsx` | 파일 편집 |
| `src/features/files/*` | 파일 UI 컴포넌트 |
| `src/app/(panel)/servers/[id]/backups/page.tsx` | 백업 화면 |
| `src/features/backups/*` | 백업 UI 컴포넌트 |
| `e2e/*`(수정) | mock 패널 확장 + files/backups e2e |

---

## Task 1: HTTP 코어 raw 지원 + 파일/백업 타입 [TDD]

**Files:**
- Modify: `src/lib/ptero/http.ts`, `src/lib/ptero/types.ts`
- Create: `src/lib/ptero/http.raw.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (raw 텍스트 응답 + raw 바디)**

`src/lib/ptero/http.raw.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { pteroFetchText, pteroFetch } from './http';

const BASE = 'https://panel.test/api/client';

describe('raw http', () => {
  it('pteroFetchText returns the raw body (file contents)', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/files/contents`, () =>
        HttpResponse.text('gamemode=survival\n')),
    );
    const text = await pteroFetchText('client', '/servers/1a2b3c4d/files/contents', { query: { file: '/server.properties' } });
    expect(text).toBe('gamemode=survival\n');
  });

  it('sends a raw body with a custom content-type (file write)', async () => {
    let received = '';
    let ctype = '';
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/files/write`, async ({ request }) => {
        received = await request.text();
        ctype = request.headers.get('content-type') ?? '';
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await pteroFetch('client', '/servers/1a2b3c4d/files/write', {
      method: 'POST',
      rawBody: 'hello=world',
      contentType: 'text/plain',
      query: { file: '/a.txt' },
    });
    expect(received).toBe('hello=world');
    expect(ctype).toContain('text/plain');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/ptero/http.raw.test.ts`
Expected: FAIL (`pteroFetchText`/`rawBody` 미지원).

- [ ] **Step 3: `http.ts` 확장**

`src/lib/ptero/http.ts` — `FetchOpts`에 필드 추가하고, 바디 처리부와 텍스트 헬퍼를 추가한다. 기존 `pteroFetch` 시그니처/동작은 유지하되 다음을 반영:
```ts
export interface FetchOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;            // JSON 바디 (application/json)
  rawBody?: string;          // 원시 바디 (contentType 지정)
  contentType?: string;      // rawBody와 함께 사용
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  retries?: number;
}
```
바디/헤더 구성부를 다음과 같이 바꾼다(헤더 계산):
```ts
const hasJson = opts.body !== undefined;
const hasRaw = opts.rawBody !== undefined;
const headers: Record<string, string> = {
  Authorization: `Bearer ${key}`,
  Accept: 'application/json',
};
if (hasJson) headers['Content-Type'] = 'application/json';
else if (hasRaw) headers['Content-Type'] = opts.contentType ?? 'text/plain';
const body = hasJson ? JSON.stringify(opts.body) : hasRaw ? opts.rawBody : undefined;
```
그리고 `fetch(url, { method, headers, body, signal: ac.signal })`로 호출. 나머지(429·timeout·정규화)는 그대로.

파일 위치 끝에 텍스트 응답 헬퍼 추가:
```ts
/** Like pteroFetch but returns the raw response body as text (e.g. file contents). */
export async function pteroFetchText(api: Api, path: string, opts: FetchOpts = {}): Promise<string> {
  const cfg = getConfig();
  const key = api === 'application' ? cfg.PTERO_APP_KEY : cfg.PTERO_CLIENT_KEY;
  const url = buildUrl(cfg.PANEL_URL, api, path, opts.query);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: '*/*' },
      signal: ac.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      let json: unknown;
      try { json = JSON.parse(text); } catch { json = undefined; }
      throw new PteroApiError(res.status, parsePteroErrors(json), res.headers.get('x-request-id') ?? undefined);
    }
    return text;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
```

- [ ] **Step 4: 파일/백업 타입 추가**

`src/lib/ptero/types.ts` 끝에 추가:
```ts
export interface FileEntry {
  name: string;
  mode: string;
  mode_bits: string;
  size: number;
  is_file: boolean;
  is_symlink: boolean;
  mimetype: string;
  created_at: string;
  modified_at: string;
}

export interface BackupEntry {
  uuid: string;
  name: string;
  bytes: number;
  checksum: string | null;
  is_locked: boolean;
  is_successful: boolean;
  created_at: string;
  completed_at: string | null;
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run src/lib/ptero/http.raw.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 6: Commit + Push**

```bash
git add src/lib/ptero/http.ts src/lib/ptero/http.raw.test.ts src/lib/ptero/types.ts
git commit -m "feat(ptero): raw text/body http support + file/backup types"
git push
```

---

## Task 2: Client API — 파일 엔드포인트 래퍼 [TDD]

**Files:**
- Modify: `src/lib/ptero/client.ts`
- Create: `src/lib/ptero/client.files.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/ptero/client.files.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listFiles, getFileDownloadUrl, deleteFiles, createFolder, getFileUploadUrl } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');

describe('client files', () => {
  it('listFiles maps directory entries', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/files/list`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('directory')).toBe('/logs');
        return HttpResponse.json({
          object: 'list',
          data: [{ object: 'file_object', attributes: { name: 'latest.log', mode: '-rw-r--r--', mode_bits: '0644', size: 12, is_file: true, is_symlink: false, mimetype: 'text/plain', created_at: '', modified_at: '' } }],
        });
      }),
    );
    const entries = await listFiles(id, '/logs');
    expect(entries[0]).toMatchObject({ name: 'latest.log', is_file: true });
  });

  it('getFileDownloadUrl returns the signed url', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/files/download`, () =>
        HttpResponse.json({ object: 'signed_url', attributes: { url: 'https://node/dl?token=x' } })),
    );
    expect(await getFileDownloadUrl(id, '/a.txt')).toBe('https://node/dl?token=x');
  });

  it('getFileUploadUrl returns the signed url', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/files/upload`, () =>
        HttpResponse.json({ object: 'signed_url', attributes: { url: 'https://node/up?token=y' } })),
    );
    expect(await getFileUploadUrl(id)).toBe('https://node/up?token=y');
  });

  it('deleteFiles posts {root, files}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/files/delete`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    await deleteFiles(id, '/', ['old.log', 'cache/']);
    expect(body).toEqual({ root: '/', files: ['old.log', 'cache/'] });
  });

  it('createFolder posts {root, name}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/files/create-folder`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    await createFolder(id, '/', 'plugins');
    expect(body).toEqual({ root: '/', name: 'plugins' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/ptero/client.files.test.ts`
Expected: FAIL (심볼 미정의).

- [ ] **Step 3: `client.ts`에 파일 함수 추가**

`src/lib/ptero/client.ts` 끝에 추가 (상단 import에 `pteroFetchText`, `FileEntry` 추가):
```ts
import { pteroFetch, pteroFetchText } from './http';
// + type FileEntry, BackupEntry from './types' (import 목록에 추가)

interface SignedUrl { attributes: { url: string } }

export async function listFiles(id: ServerIdentifier, directory = '/'): Promise<FileEntry[]> {
  const res = await pteroFetch<PteroList<FileEntry>>('client', `/servers/${id}/files/list`, { query: { directory } });
  return res.data.map((d) => d.attributes);
}

export function getFileContents(id: ServerIdentifier, file: string): Promise<string> {
  return pteroFetchText('client', `/servers/${id}/files/contents`, { query: { file } });
}

export async function writeFile(id: ServerIdentifier, file: string, content: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/write`, { method: 'POST', rawBody: content, contentType: 'text/plain', query: { file } });
}

export async function getFileDownloadUrl(id: ServerIdentifier, file: string): Promise<string> {
  const res = await pteroFetch<SignedUrl>('client', `/servers/${id}/files/download`, { query: { file } });
  return res.attributes.url;
}

export async function getFileUploadUrl(id: ServerIdentifier): Promise<string> {
  const res = await pteroFetch<SignedUrl>('client', `/servers/${id}/files/upload`);
  return res.attributes.url;
}

export async function renameFiles(id: ServerIdentifier, root: string, files: Array<{ from: string; to: string }>): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/rename`, { method: 'PUT', body: { root, files } });
}

export async function copyFile(id: ServerIdentifier, location: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/copy`, { method: 'POST', body: { location } });
}

export async function compressFiles(id: ServerIdentifier, root: string, files: string[]): Promise<FileEntry> {
  const res = await pteroFetch<{ attributes: FileEntry }>('client', `/servers/${id}/files/compress`, { method: 'POST', body: { root, files } });
  return res.attributes;
}

export async function decompressFile(id: ServerIdentifier, root: string, file: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/decompress`, { method: 'POST', body: { root, file } });
}

export async function deleteFiles(id: ServerIdentifier, root: string, files: string[]): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/delete`, { method: 'POST', body: { root, files } });
}

export async function createFolder(id: ServerIdentifier, root: string, name: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/create-folder`, { method: 'POST', body: { root, name } });
}

export async function chmodFiles(id: ServerIdentifier, root: string, files: Array<{ file: string; mode: string }>): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/chmod`, { method: 'POST', body: { root, files } });
}

export async function pullRemoteFile(id: ServerIdentifier, opts: { url: string; directory?: string; filename?: string; useHeader?: boolean; foreground?: boolean }): Promise<void> {
  await pteroFetch('client', `/servers/${id}/files/pull`, { method: 'POST', body: { url: opts.url, directory: opts.directory, filename: opts.filename, use_header: opts.useHeader, foreground: opts.foreground } });
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/ptero/client.files.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/ptero/client.ts src/lib/ptero/client.files.test.ts
git commit -m "feat(ptero): client file endpoints (list/read/write/rename/copy/compress/delete/chmod/pull/signed urls)"
git push
```

---

## Task 3: Client API — 백업 엔드포인트 래퍼 [TDD]

**Files:**
- Modify: `src/lib/ptero/client.ts`
- Create: `src/lib/ptero/client.backups.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/ptero/client.backups.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listBackups, createBackup, getBackupDownloadUrl, restoreBackup, deleteBackup } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');

describe('client backups', () => {
  it('listBackups maps entries', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/backups`, () =>
        HttpResponse.json({ object: 'list', data: [{ object: 'backup', attributes: { uuid: 'b-1', name: 'daily', bytes: 1024, checksum: 'abc', is_locked: false, is_successful: true, created_at: '', completed_at: '' } }], meta: { pagination: { total: 1, count: 1, per_page: 20, current_page: 1, total_pages: 1 } } })),
    );
    const out = await listBackups(id);
    expect(out[0]).toMatchObject({ uuid: 'b-1', name: 'daily', is_successful: true });
  });

  it('createBackup posts {name}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/backups`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'backup', attributes: { uuid: 'b-2', name: 'manual', bytes: 0, checksum: null, is_locked: false, is_successful: false, created_at: '', completed_at: null } }); }),
    );
    const b = await createBackup(id, { name: 'manual' });
    expect(body).toEqual({ name: 'manual' });
    expect(b.uuid).toBe('b-2');
  });

  it('getBackupDownloadUrl returns the signed url', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/backups/b-1/download`, () =>
        HttpResponse.json({ object: 'signed_url', attributes: { url: 'https://node/bk?token=z' } })),
    );
    expect(await getBackupDownloadUrl(id, 'b-1')).toBe('https://node/bk?token=z');
  });

  it('restoreBackup posts {truncate}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/backups/b-1/restore`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    await restoreBackup(id, 'b-1', true);
    expect(body).toEqual({ truncate: true });
  });

  it('deleteBackup DELETEs', async () => {
    let called = false;
    mswServer.use(
      http.delete(`${BASE}/servers/1a2b3c4d/backups/b-1`, () => { called = true; return new HttpResponse(null, { status: 204 }); }),
    );
    await deleteBackup(id, 'b-1');
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/ptero/client.backups.test.ts`
Expected: FAIL.

- [ ] **Step 3: `client.ts`에 백업 함수 추가**

```ts
export async function listBackups(id: ServerIdentifier): Promise<BackupEntry[]> {
  const res = await pteroFetch<PteroList<BackupEntry>>('client', `/servers/${id}/backups`, { query: { per_page: 100 } });
  return res.data.map((d) => d.attributes);
}

export async function createBackup(id: ServerIdentifier, opts: { name?: string; ignored?: string; isLocked?: boolean } = {}): Promise<BackupEntry> {
  const res = await pteroFetch<{ attributes: BackupEntry }>('client', `/servers/${id}/backups`, { method: 'POST', body: { name: opts.name, ignored: opts.ignored, is_locked: opts.isLocked } });
  return res.attributes;
}

export async function getBackupDownloadUrl(id: ServerIdentifier, backupUuid: string): Promise<string> {
  const res = await pteroFetch<{ attributes: { url: string } }>('client', `/servers/${id}/backups/${backupUuid}/download`);
  return res.attributes.url;
}

export async function toggleBackupLock(id: ServerIdentifier, backupUuid: string): Promise<BackupEntry> {
  const res = await pteroFetch<{ attributes: BackupEntry }>('client', `/servers/${id}/backups/${backupUuid}/lock`, { method: 'POST' });
  return res.attributes;
}

export async function restoreBackup(id: ServerIdentifier, backupUuid: string, truncate = false): Promise<void> {
  await pteroFetch('client', `/servers/${id}/backups/${backupUuid}/restore`, { method: 'POST', body: { truncate } });
}

export async function deleteBackup(id: ServerIdentifier, backupUuid: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/backups/${backupUuid}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/ptero/client.backups.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/ptero/client.ts src/lib/ptero/client.backups.test.ts
git commit -m "feat(ptero): client backup endpoints (list/create/download/lock/restore/delete)"
git push
```

---

## Task 4: 파일 Server Actions (가드) [TDD]

**Files:**
- Create: `src/server/files.ts`, `src/server/files.test.ts`

> 기존 `src/server/servers.ts`의 `scope(user)` + `requireServerAccess` 패턴을 그대로 따른다. 거부는 페이지 로더에선 `notFound()`, mutation에선 결과 객체로.

- [ ] **Step 1: 실패 테스트 작성 (스코프 가드 + 위임)**

`src/server/files.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null })),
}));

import { listFilesAction } from './files';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => invalidateAccessCache());

function adminListsServer(identifier: string) {
  mswServer.use(
    http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: { identifier, uuid: `${identifier}-0000-4000-8000-000000000000`, name: 'S' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })),
  );
}

describe('listFilesAction', () => {
  it('returns entries for an accessible server', async () => {
    adminListsServer('1a2b3c4d');
    mswServer.use(http.get(`${CLIENT}/servers/1a2b3c4d/files/list`, () => HttpResponse.json({ object: 'list', data: [{ object: 'file_object', attributes: { name: 'a.txt', mode: '-rw-r--r--', mode_bits: '0644', size: 1, is_file: true, is_symlink: false, mimetype: 'text/plain', created_at: '', modified_at: '' } }] })));
    const res = await listFilesAction('1a2b3c4d', '/');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entries[0].name).toBe('a.txt');
  });

  it('returns not_found for an inaccessible server', async () => {
    adminListsServer('1a2b3c4d');
    const res = await listFilesAction('deadbeef', '/');
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/server/files.test.ts`
Expected: FAIL (`listFilesAction` 미정의).

- [ ] **Step 3: `src/server/files.ts` 구현**

```ts
'use server';

import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier, type FileEntry } from '@/lib/ptero/types';
import * as ptero from '@/lib/ptero/client';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser {
  return { id: u.id, role: u.role, pteroUserId: u.pteroUserId };
}

type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;

async function guard(identifier: string) {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  await requireServerAccess(scope(user), id);
  return { user, id };
}

function toFail(err: unknown): Fail {
  if (err instanceof ServerAccessDeniedError) return { ok: false, error: 'not_found' };
  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('file action failed', err);
  return { ok: false, error: 'failed', detail };
}

export async function listFilesAction(identifier: string, directory: string): Promise<Ok<{ entries: FileEntry[] }> | Fail> {
  try {
    const { id } = await guard(identifier);
    return { ok: true, entries: await ptero.listFiles(id, directory) };
  } catch (err) { return toFail(err); }
}

export async function readFileAction(identifier: string, file: string): Promise<Ok<{ content: string }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, content: await ptero.getFileContents(id, file) }; }
  catch (err) { return toFail(err); }
}

export async function writeFileAction(identifier: string, file: string, content: string): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.writeFile(id, file, content); await audit('file.write', { userId: user.id, target: id, metadata: { file } }); return { ok: true }; }
  catch (err) { return toFail(err); }
}

export async function deleteFilesAction(identifier: string, root: string, files: string[]): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.deleteFiles(id, root, files); await audit('file.delete', { userId: user.id, target: id, metadata: { root, files } }); return { ok: true }; }
  catch (err) { return toFail(err); }
}

export async function createFolderAction(identifier: string, root: string, name: string): Promise<Ok<{}> | Fail> {
  try { const { id } = await guard(identifier); await ptero.createFolder(id, root, name); return { ok: true }; }
  catch (err) { return toFail(err); }
}

export async function renameAction(identifier: string, root: string, files: Array<{ from: string; to: string }>): Promise<Ok<{}> | Fail> {
  try { const { id } = await guard(identifier); await ptero.renameFiles(id, root, files); return { ok: true }; }
  catch (err) { return toFail(err); }
}

export async function compressAction(identifier: string, root: string, files: string[]): Promise<Ok<{ archive: FileEntry }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, archive: await ptero.compressFiles(id, root, files) }; }
  catch (err) { return toFail(err); }
}

export async function decompressAction(identifier: string, root: string, file: string): Promise<Ok<{}> | Fail> {
  try { const { id } = await guard(identifier); await ptero.decompressFile(id, root, file); return { ok: true }; }
  catch (err) { return toFail(err); }
}

export async function chmodAction(identifier: string, root: string, files: Array<{ file: string; mode: string }>): Promise<Ok<{}> | Fail> {
  try { const { id } = await guard(identifier); await ptero.chmodFiles(id, root, files); return { ok: true }; }
  catch (err) { return toFail(err); }
}

export async function pullAction(identifier: string, opts: { url: string; directory?: string; filename?: string }): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.pullRemoteFile(id, opts); await audit('file.pull', { userId: user.id, target: id, metadata: opts }); return { ok: true }; }
  catch (err) { return toFail(err); }
}

export async function getDownloadUrlAction(identifier: string, file: string): Promise<Ok<{ url: string }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, url: await ptero.getFileDownloadUrl(id, file) }; }
  catch (err) { return toFail(err); }
}

export async function getUploadUrlAction(identifier: string): Promise<Ok<{ url: string }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, url: await ptero.getFileUploadUrl(id) }; }
  catch (err) { return toFail(err); }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/server/files.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/server/files.ts src/server/files.test.ts
git commit -m "feat(files): guarded file server actions"
git push
```

---

## Task 5: 백업 Server Actions (가드) [TDD]

**Files:**
- Create: `src/server/backups.ts`, `src/server/backups.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/server/backups.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null })),
}));

import { listBackupsAction } from './backups';

const CLIENT = 'https://panel.test/api/client';
beforeEach(() => invalidateAccessCache());

function adminListsServer(identifier: string) {
  mswServer.use(http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: { identifier, uuid: `${identifier}-0000-4000-8000-000000000000`, name: 'S' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
}

describe('listBackupsAction', () => {
  it('returns backups for an accessible server', async () => {
    adminListsServer('1a2b3c4d');
    mswServer.use(http.get(`${CLIENT}/servers/1a2b3c4d/backups`, () => HttpResponse.json({ object: 'list', data: [{ object: 'backup', attributes: { uuid: 'b1', name: 'd', bytes: 1, checksum: null, is_locked: false, is_successful: true, created_at: '', completed_at: '' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
    const res = await listBackupsAction('1a2b3c4d');
    expect(res.ok && res.backups[0].uuid).toBe('b1');
  });

  it('returns not_found for inaccessible server', async () => {
    adminListsServer('1a2b3c4d');
    expect(await listBackupsAction('deadbeef')).toEqual({ ok: false, error: 'not_found' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/server/backups.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/server/backups.ts` 구현**

```ts
'use server';

import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier, type BackupEntry } from '@/lib/ptero/types';
import * as ptero from '@/lib/ptero/client';
import { audit } from '@/lib/audit';
import { PteroApiError } from '@/lib/ptero/errors';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser { return { id: u.id, role: u.role, pteroUserId: u.pteroUserId }; }
type Fail = { ok: false; error: 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;

async function guard(identifier: string) {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  await requireServerAccess(scope(user), id);
  return { user, id };
}
function toFail(err: unknown): Fail {
  if (err instanceof ServerAccessDeniedError) return { ok: false, error: 'not_found' };
  const detail = err instanceof PteroApiError ? err.primary?.detail : undefined;
  console.error('backup action failed', err);
  return { ok: false, error: 'failed', detail };
}

export async function listBackupsAction(identifier: string): Promise<Ok<{ backups: BackupEntry[] }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, backups: await ptero.listBackups(id) }; }
  catch (err) { return toFail(err); }
}

export async function createBackupAction(identifier: string, name?: string): Promise<Ok<{ backup: BackupEntry }> | Fail> {
  try { const { user, id } = await guard(identifier); const backup = await ptero.createBackup(id, { name }); await audit('backup.create', { userId: user.id, target: id, metadata: { name } }); return { ok: true, backup }; }
  catch (err) { return toFail(err); }
}

export async function backupDownloadUrlAction(identifier: string, uuid: string): Promise<Ok<{ url: string }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, url: await ptero.getBackupDownloadUrl(id, uuid) }; }
  catch (err) { return toFail(err); }
}

export async function restoreBackupAction(identifier: string, uuid: string, truncate: boolean): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.restoreBackup(id, uuid, truncate); await audit('backup.restore', { userId: user.id, target: id, metadata: { uuid, truncate } }); return { ok: true }; }
  catch (err) { return toFail(err); }
}

export async function toggleBackupLockAction(identifier: string, uuid: string): Promise<Ok<{ backup: BackupEntry }> | Fail> {
  try { const { id } = await guard(identifier); return { ok: true, backup: await ptero.toggleBackupLock(id, uuid) }; }
  catch (err) { return toFail(err); }
}

export async function deleteBackupAction(identifier: string, uuid: string): Promise<Ok<{}> | Fail> {
  try { const { user, id } = await guard(identifier); await ptero.deleteBackup(id, uuid); await audit('backup.delete', { userId: user.id, target: id, metadata: { uuid } }); return { ok: true }; }
  catch (err) { return toFail(err); }
}
```

- [ ] **Step 4: 통과 확인 + Commit + Push**

Run: `pnpm vitest run src/server/backups.test.ts` → 2 PASS.
```bash
git add src/server/backups.ts src/server/backups.test.ts
git commit -m "feat(backups): guarded backup server actions"
git push
```

---

## Task 6: 탭 등록 + 파일 브라우저 UI

**Files:**
- Modify: `src/registry/server-tabs.ts`, `src/registry/server-tabs.test.ts`
- Create: `src/features/files/file-browser.tsx`, `src/app/(panel)/servers/[id]/files/page.tsx`

- [ ] **Step 1: 레지스트리에 files·backups 탭 추가 + 테스트 갱신**

`src/registry/server-tabs.ts`의 `serverTabs` 배열에 추가:
```ts
export const serverTabs: ServerTab[] = [
  { key: 'overview', label: '개요', href: (id) => `/servers/${id}` },
  { key: 'console', label: '콘솔', href: (id) => `/servers/${id}/console` },
  { key: 'files', label: '파일', href: (id) => `/servers/${id}/files` },
  { key: 'backups', label: '백업', href: (id) => `/servers/${id}/backups` },
];
```
`server-tabs.test.ts`의 built-in 검사에 `files`·`backups` 포함을 추가:
```ts
expect(keys).toEqual(expect.arrayContaining(['overview', 'console', 'files', 'backups']));
```

- [ ] **Step 2: 파일 브라우저(Client) 작성**

`src/features/files/file-browser.tsx`:
```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { listFilesAction, deleteFilesAction, createFolderAction, getDownloadUrlAction, getUploadUrlAction } from '@/server/files';
import type { FileEntry } from '@/lib/ptero/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

function joinPath(dir: string, name: string) {
  return `${dir.replace(/\/$/, '')}/${name}`;
}

export function FileBrowser({ identifier }: { identifier: string }) {
  const [dir, setDir] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load(target: string) {
    setError(null);
    start(async () => {
      const res = await listFilesAction(identifier, target);
      if (res.ok) { setEntries(res.entries); setDir(target); }
      else setError(res.error === 'not_found' ? '서버를 찾을 수 없습니다.' : (res.detail ?? '불러오기 실패'));
    });
  }
  useEffect(() => { load('/'); /* eslint-disable-next-line */ }, [identifier]);

  const crumbs = dir.split('/').filter(Boolean);

  async function onDelete(name: string) {
    if (!confirm(`${name} 삭제할까요?`)) return;
    const res = await deleteFilesAction(identifier, dir, [name]);
    if (res.ok) load(dir); else alert(res.detail ?? '삭제 실패');
  }
  async function onNewFolder() {
    const name = prompt('새 폴더 이름');
    if (!name) return;
    const res = await createFolderAction(identifier, dir, name);
    if (res.ok) load(dir); else alert(res.detail ?? '폴더 생성 실패');
  }
  async function onDownload(name: string) {
    const res = await getDownloadUrlAction(identifier, joinPath(dir, name));
    if (res.ok) window.open(res.url, '_blank'); else alert(res.detail ?? '다운로드 URL 실패');
  }
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await getUploadUrlAction(identifier);
    if (!res.ok) { alert(res.detail ?? '업로드 URL 실패'); return; }
    const form = new FormData();
    form.append('files', file);
    await fetch(`${res.url}&directory=${encodeURIComponent(dir)}`, { method: 'POST', body: form });
    load(dir);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-500">
          <button className="hover:underline" onClick={() => load('/')}>root</button>
          {crumbs.map((c, i) => (
            <span key={i}> / <button className="hover:underline" onClick={() => load('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button></span>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onNewFolder}>새 폴더</Button>
          <label className="inline-flex cursor-pointer items-center rounded-md bg-zinc-200 px-3 py-2 text-sm dark:bg-zinc-700">
            업로드<input type="file" className="hidden" onChange={onUpload} />
          </label>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Card className="p-0">
        <table className="w-full text-sm">
          <tbody>
            {dir !== '/' && (
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2"><button onClick={() => load('/' + crumbs.slice(0, -1).join('/'))}>..</button></td>
                <td /><td />
              </tr>
            )}
            {entries.map((f) => (
              <tr key={f.name} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2">
                  {f.is_file ? (
                    <Link href={`/servers/${identifier}/files/edit?path=${encodeURIComponent(joinPath(dir, f.name))}`}>{f.name}</Link>
                  ) : (
                    <button className="font-medium" onClick={() => load(joinPath(dir, f.name))}>{f.name}/</button>
                  )}
                </td>
                <td className="px-4 py-2 text-right text-zinc-500">{f.is_file ? `${f.size} B` : ''}</td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {f.is_file && <Button variant="ghost" onClick={() => onDownload(f.name)}>↓</Button>}
                    <Button variant="ghost" onClick={() => onDelete(f.name)}>🗑</Button>
                  </div>
                </td>
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

- [ ] **Step 3: 파일 페이지 작성**

`src/app/(panel)/servers/[id]/files/page.tsx`:
```tsx
import { FileBrowser } from '@/features/files/file-browser';

export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FileBrowser identifier={id} />;
}
```

- [ ] **Step 4: 레지스트리 테스트 통과 + 타입체크**

Run: `pnpm vitest run src/registry/server-tabs.test.ts && pnpm typecheck`
Expected: PASS, 타입 그린.

- [ ] **Step 5: Commit + Push**

```bash
git add src/registry/server-tabs.ts src/registry/server-tabs.test.ts src/features/files/ "src/app/(panel)/servers/[id]/files/page.tsx"
git commit -m "feat(files): server-view files tab + file browser (list/navigate/delete/folder/upload/download)"
git push
```

---

## Task 7: 파일 편집기 (읽기/저장)

**Files:**
- Create: `src/features/files/file-editor.tsx`, `src/app/(panel)/servers/[id]/files/edit/page.tsx`

- [ ] **Step 1: 편집기(Client) 작성**

`src/features/files/file-editor.tsx`:
```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { readFileAction, writeFileAction } from '@/server/files';
import { Button } from '@/components/ui/button';

export function FileEditor({ identifier, path }: { identifier: string; path: string }) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const res = await readFileAction(identifier, path);
      if (res.ok) { setContent(res.content); setStatus('ready'); }
      else { setStatus('error'); setMsg(res.error === 'not_found' ? '찾을 수 없음' : (res.detail ?? '읽기 실패')); }
    })();
  }, [identifier, path]);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await writeFileAction(identifier, path, content);
      setMsg(res.ok ? '저장됨' : (res.detail ?? '저장 실패'));
    });
  }

  if (status === 'loading') return <p className="text-sm text-zinc-500">불러오는 중…</p>;
  if (status === 'error') return <p className="text-sm text-red-600">{msg}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <code className="text-sm text-zinc-500">{path}</code>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm text-zinc-500">{msg}</span>}
          <Button variant="secondary" onClick={() => router.back()}>뒤로</Button>
          <Button onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
        </div>
      </div>
      <textarea
        className="h-[60vh] w-full rounded-md border border-zinc-300 bg-zinc-950 p-3 font-mono text-sm text-zinc-100 dark:border-zinc-700"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
```

- [ ] **Step 2: 편집 페이지 작성**

`src/app/(panel)/servers/[id]/files/edit/page.tsx`:
```tsx
import { FileEditor } from '@/features/files/file-editor';

export default async function FileEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { id } = await params;
  const { path } = await searchParams;
  if (!path) return <p className="text-sm text-red-600">경로가 필요합니다.</p>;
  return <FileEditor identifier={id} path={path} />;
}
```

- [ ] **Step 3: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add src/features/files/file-editor.tsx "src/app/(panel)/servers/[id]/files/edit/page.tsx"
git commit -m "feat(files): file editor (read/save)"
git push
```

---

## Task 8: 백업 UI

**Files:**
- Create: `src/features/backups/backups-view.tsx`, `src/app/(panel)/servers/[id]/backups/page.tsx`

- [ ] **Step 1: 백업 뷰(Client) 작성**

`src/features/backups/backups-view.tsx`:
```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { listBackupsAction, createBackupAction, backupDownloadUrlAction, restoreBackupAction, deleteBackupAction, toggleBackupLockAction } from '@/server/backups';
import type { BackupEntry } from '@/lib/ptero/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function BackupsView({ identifier }: { identifier: string }) {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const res = await listBackupsAction(identifier);
      if (res.ok) setBackups(res.backups);
      else setMsg(res.error === 'not_found' ? '서버를 찾을 수 없습니다.' : (res.detail ?? '불러오기 실패'));
    });
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [identifier]);

  async function create() {
    const name = prompt('백업 이름(선택)') ?? undefined;
    const res = await createBackupAction(identifier, name || undefined);
    if (res.ok) load(); else alert(res.detail ?? '생성 실패');
  }
  async function download(b: BackupEntry) {
    const res = await backupDownloadUrlAction(identifier, b.uuid);
    if (res.ok) window.open(res.url, '_blank'); else alert(res.detail ?? '다운로드 실패');
  }
  async function restore(b: BackupEntry) {
    if (!confirm(`${b.name} 복원? 기존 파일을 덮어쓸 수 있습니다.`)) return;
    const res = await restoreBackupAction(identifier, b.uuid, false);
    alert(res.ok ? '복원을 시작했습니다.' : (res.detail ?? '복원 실패'));
  }
  async function remove(b: BackupEntry) {
    if (b.is_locked) { alert('잠긴 백업은 삭제할 수 없습니다.'); return; }
    if (!confirm(`${b.name} 삭제?`)) return;
    const res = await deleteBackupAction(identifier, b.uuid);
    if (res.ok) load(); else alert(res.detail ?? '삭제 실패');
  }
  async function toggleLock(b: BackupEntry) {
    const res = await toggleBackupLockAction(identifier, b.uuid);
    if (res.ok) load(); else alert(res.detail ?? '잠금 변경 실패');
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">백업</h2>
        <Button onClick={create}>백업 생성</Button>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Card className="p-0">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500"><th className="px-4 py-2">이름</th><th className="px-4 py-2">크기</th><th className="px-4 py-2">상태</th><th /></tr></thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.uuid} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2">{b.is_locked ? '🔒 ' : ''}{b.name}</td>
                <td className="px-4 py-2 text-zinc-500">{(b.bytes / 1048576).toFixed(1)} MB</td>
                <td className="px-4 py-2">{b.is_successful ? '완료' : '진행/실패'}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => download(b)} disabled={!b.is_successful}>↓</Button>
                    <Button variant="ghost" onClick={() => restore(b)} disabled={!b.is_successful}>복원</Button>
                    <Button variant="ghost" onClick={() => toggleLock(b)}>{b.is_locked ? '잠금해제' : '잠금'}</Button>
                    <Button variant="ghost" onClick={() => remove(b)}>🗑</Button>
                  </div>
                </td>
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

- [ ] **Step 2: 백업 페이지 작성**

`src/app/(panel)/servers/[id]/backups/page.tsx`:
```tsx
import { BackupsView } from '@/features/backups/backups-view';

export default async function BackupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BackupsView identifier={id} />;
}
```

- [ ] **Step 3: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add src/features/backups/ "src/app/(panel)/servers/[id]/backups/page.tsx"
git commit -m "feat(backups): server-view backups tab (list/create/download/restore/delete/lock)"
git push
```

---

## Task 9: e2e 확장 + 최종 검증

**Files:**
- Modify: `e2e/mock-panel.mjs`, `e2e/scope.spec.ts` (또는 새 `e2e/files-backups.spec.ts`), `README.md`

- [ ] **Step 1: mock 패널에 파일/백업 엔드포인트 추가**

`e2e/mock-panel.mjs`의 라우팅에 추가(기존 `OWNED.identifier = '1a2b3c4d'` 기준):
```js
if (p === '/api/client/servers/1a2b3c4d/files/list') {
  return json({ object: 'list', data: [{ object: 'file_object', attributes: { name: 'server.properties', mode: '-rw-r--r--', mode_bits: '0644', size: 20, is_file: true, is_symlink: false, mimetype: 'text/plain', created_at: '', modified_at: '' } }] });
}
if (p === '/api/client/servers/1a2b3c4d/backups') {
  return json({ object: 'list', data: [{ object: 'backup', attributes: { uuid: 'bk-1', name: 'daily', bytes: 1048576, checksum: 'abc', is_locked: false, is_successful: true, created_at: '', completed_at: '' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } });
}
```

- [ ] **Step 2: e2e 스펙 작성**

`e2e/files-backups.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

async function login(page, id: string, pw: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="password"]', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

test('USER sees files listing on owned server', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/servers/1a2b3c4d/files');
  await expect(page.getByText('server.properties')).toBeVisible();
});

test('USER sees backups on owned server', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/servers/1a2b3c4d/backups');
  await expect(page.getByText('daily')).toBeVisible();
});

test('files tab on non-owned server is 404', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  const res = await page.goto('/servers/9z9z9z9z/files');
  expect(res?.status()).toBe(404);
});
```

> 참고: `[id]/files/page.tsx`·`backups/page.tsx`는 부모 `[id]/layout.tsx`의 `requireServerAccess`로 이미 가드되므로, 비소유 서버 접근 시 layout이 `notFound()` → 404.

- [ ] **Step 3: README 기능 목록 갱신**

`README.md`의 기능/로드맵 섹션에 "파일 매니저·백업"이 구현됨을 반영(원격 풀은 `api.disable_remote_download:false` 필요 명시).

- [ ] **Step 4: 전체 검증**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
```
Expected: 전부 그린(신규 client/files/backups 단위 테스트 + 기존 + e2e files/backups 3종).

- [ ] **Step 5: Commit + Push**

```bash
git add e2e/ README.md
git commit -m "test(e2e): files & backups flows + README update"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지:** 부록 A §3.3 파일(list/contents/download/write/rename/copy/compress/decompress/delete/create-folder/chmod/pull/upload) ✓ T1–2,4,6,7 · §3.4 백업(list/create/get download/lock/restore/delete) ✓ T3,5,8 · §4 인가(모든 액션 `requireServerAccess`·404) ✓ T4,5,9 · §9 raw 응답/바디 ✓ T1 · 탭 레지스트리 seam 재사용 ✓ T6.
- **보안 불변식 유지:** 모든 파일/백업 액션이 `guard()`(requireUser→requireServerAccess) 선행. 업/다운로드는 서명 URL(키 비노출). 업로드는 브라우저→Wings 직접(서명 URL). 콘솔과 동일하게 키는 서버 전용.
- **플레이스홀더 스캔:** 모든 코드/명령 실측. TBD 없음.
- **타입 일관성:** 파일/백업 액션 결과 `Ok<T> | Fail` 패턴이 기존 `PowerResult`와 정합. `ServerIdentifier`/`asIdentifier`·`FileEntry`/`BackupEntry`·`PteroApiError.primary?.detail` 일관 사용. `serverTabs` 확장이 기존 `[id]/layout.tsx` 렌더와 호환.
- **레이트리밋:** 파일 목록/내용은 REST(버킷 사용)지만 사용자 능동 동작·저빈도. 원격 풀은 패널 측 10/5분 스로틀(부록 A) — 에러 정규화로 429 처리됨.
- **환경 의존:** `*.test.ts`(MSW)는 패널 불필요. e2e는 mock 패널 + 테스트 DB. 통합 DB 테스트는 별도.

---

## 다음
이 Phase 완료 후 로드맵: Phase 3(관리자 코어: 유저/서버생성/노드) → Phase 4(DB·스케줄·네트워크·Startup·서브유저·설정) → Phase 5(마감) → Phase 6(플러그인). 각 Phase는 자체 plan을 추가한다.
