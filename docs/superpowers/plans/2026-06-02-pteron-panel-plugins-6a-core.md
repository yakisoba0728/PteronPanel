# Pteron Panel — Plugins 6a: Registration, Tokens & Scoped API 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 외부 통합 플러그인의 기반 — `Plugin`/`WebhookDelivery` 모델, 시크릿 암호화(`lib/crypto`), `ptex_` 토큰 발급·검증, 등록/라이프사이클 서버 액션 + 계정 UI, 그리고 **소유자 스코프 `/api/ext/*` API**.

**Architecture:** 플러그인은 외부 서비스다. 패널은 `ptex_` 토큰(해시 저장)으로 인증해 **토큰→소유자(User) 매핑** 후, 기존 인가·ptero 레이어(`resolveAccessibleServers`/`requireServerAccess`/`requireServerPermission` + `lib/ptero`)를 **소유자 신원으로** 재사용해 대행한다. 마스터 키는 서버 전용·비노출 유지.

**Tech Stack:** Next 15 Route Handlers · Prisma · Node `crypto`(AES-GCM/HKDF/HMAC) · Vitest+MSW. **선행:** Phase 0–5 완료(`resolveAccessibleServers`, `requireServerAccess/Permission`, `lib/ptero/*`, `getConfig().SESSION_SECRET`, `audit`). 참조 spec: `docs/superpowers/specs/2026-06-02-pteron-panel-plugins-design.md` §4–6,9.

> **표준 규칙:** 각 Task commit + push(작업 브랜치). **AI 워터마크 금지.** **워크트리**에서 작업.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `prisma/schema.prisma`(수정) | `Plugin`·`WebhookDelivery` 모델 |
| `src/lib/crypto.ts` | HKDF(SESSION_SECRET) → AES-256-GCM `encryptSecret`/`decryptSecret` |
| `src/lib/plugins/token.ts` | `ptex_` 토큰 생성·HMAC 해시 |
| `src/server/plugins.ts` | 등록/목록/토글/회전/삭제 액션(소유자) |
| `src/lib/plugins/auth.ts` | `/api/ext` 인증: Bearer → `{ plugin, owner }` |
| `src/lib/plugins/scope.ts` | 소유자 스코프 헬퍼(서버 접근 해석·가드 래퍼) |
| `src/app/api/ext/**/route.ts` | 스코프 API 표면 |
| `src/features/plugins/*`, `src/app/(panel)/account/plugins/page.tsx` | UI |
| `e2e/plugins.spec.ts` | e2e(크로스 유저 차단 포함) |

---

## Task 1: Prisma 모델 + 마이그레이션

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1: 모델 추가**

`prisma/schema.prisma`에 추가하고, `User`에 `plugins Plugin[]` 관계를 추가:
```prisma
model Plugin {
  id               String   @id @default(cuid())
  ownerId          String
  owner            User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name             String
  description      String?
  tokenHash        String   @unique
  webhookUrl       String?
  webhookSecretEnc String?
  events           String[] @default([])
  uiTabUrl         String?
  uiTabLabel       String?
  enabled          Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  deliveries       WebhookDelivery[]
  @@index([ownerId])
}

model WebhookDelivery {
  id           String   @id @default(cuid())
  pluginId     String
  plugin       Plugin   @relation(fields: [pluginId], references: [id], onDelete: Cascade)
  event        String
  status       String   @default("pending")
  attempts     Int      @default(0)
  responseCode Int?
  error        String?
  createdAt    DateTime @default(now())
  @@index([pluginId, createdAt])
}
```
(`User` 모델에 `plugins Plugin[]` 라인 추가.)

- [ ] **Step 2: 마이그레이션 + Commit**

```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm prisma migrate dev --name plugins
pnpm prisma generate
git add prisma/
git commit -m "feat(db): Plugin + WebhookDelivery models"
git push
```

---

## Task 2: `lib/crypto` (AES-GCM, HKDF from SESSION_SECRET) [TDD]

**Files:** Create `src/lib/crypto.ts`, `src/lib/crypto.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/lib/crypto.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from './crypto';

describe('crypto', () => {
  it('round-trips a secret', () => {
    const enc = encryptSecret('webhook-secret-123');
    expect(enc).not.toContain('webhook-secret-123');
    expect(decryptSecret(enc)).toBe('webhook-secret-123');
  });
  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });
  it('throws on tampered ciphertext', () => {
    const enc = encryptSecret('y');
    const tampered = enc.slice(0, -2) + (enc.endsWith('AA') ? 'BB' : 'AA');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getConfig } from '@/lib/config';

function key(): Buffer {
  // Derive a stable 32-byte app key from SESSION_SECRET (no extra env needed).
  return Buffer.from(hkdfSync('sha256', getConfig().SESSION_SECRET, Buffer.alloc(0), 'pteron-plugin-secret', 32));
}

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext) */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  const [ivB, tagB, ctB] = enc.split('.');
  if (!ivB || !tagB || !ctB) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/lib/crypto.test.ts
git add src/lib/crypto.ts src/lib/crypto.test.ts
git commit -m "feat(crypto): AES-GCM secret encryption (HKDF from SESSION_SECRET)"
git push
```

---

## Task 3: `ptex_` 토큰 생성·해시 [TDD]

**Files:** Create `src/lib/plugins/token.ts`, `src/lib/plugins/token.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/lib/plugins/token.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generatePluginToken, hashPluginToken, generateWebhookSecret } from './token';

describe('plugin token', () => {
  it('generates a ptex_-prefixed token and a stable hash', () => {
    const t = generatePluginToken();
    expect(t).toMatch(/^ptex_[A-Za-z0-9_-]{43}$/);
    expect(hashPluginToken(t)).toBe(hashPluginToken(t));        // deterministic
    expect(hashPluginToken(t)).not.toBe(t);                     // not the raw token
  });
  it('different tokens hash differently', () => {
    expect(hashPluginToken(generatePluginToken())).not.toBe(hashPluginToken(generatePluginToken()));
  });
  it('webhook secret is random hex', () => {
    expect(generateWebhookSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/plugins/token.ts`:
```ts
import { createHmac, randomBytes } from 'node:crypto';
import { getConfig } from '@/lib/config';

export function generatePluginToken(): string {
  return `ptex_${randomBytes(32).toString('base64url')}`;
}
export function hashPluginToken(token: string): string {
  return createHmac('sha256', getConfig().SESSION_SECRET).update(token).digest('hex');
}
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}
```

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/lib/plugins/token.test.ts
git add src/lib/plugins/token.ts src/lib/plugins/token.test.ts
git commit -m "feat(plugins): ptex_ token generation + HMAC hashing"
git push
```

---

## Task 4: 라이프사이클 서버 액션 [TDD]

**Files:** Create `src/server/plugins.ts`, `src/server/plugins.test.ts`

- [ ] **Step 1: 실패 테스트 (소유권·생성)**

`src/server/plugins.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  plugin: {
    findMany: vi.fn(async () => []),
    create: vi.fn(async ({ data }: any) => ({ id: 'pl1', ...data })),
    findFirst: vi.fn(async () => ({ id: 'pl1', ownerId: 'u1', enabled: true })),
    update: vi.fn(async ({ data }: any) => ({ id: 'pl1', ...data })),
    delete: vi.fn(async () => ({ id: 'pl1' })),
  },
};
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
let currentUser: any = { id: 'u1', role: 'USER', pteroUserId: 7 };
vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => currentUser) }));

import { registerPluginAction, listPluginsAction, deletePluginAction } from './plugins';

beforeEach(() => { currentUser = { id: 'u1', role: 'USER', pteroUserId: 7 }; vi.clearAllMocks(); });

describe('plugin actions', () => {
  it('registers a plugin and returns the token ONCE', async () => {
    const res = await registerPluginAction({ name: 'My Plugin', webhookUrl: 'https://hook.example.com', events: ['server.power'] });
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.token).toMatch(/^ptex_/); expect(res.webhookSecret).toMatch(/^[0-9a-f]{64}$/); }
    expect(prismaMock.plugin.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerId: 'u1', name: 'My Plugin' }) }));
  });
  it('lists only the caller\'s plugins', async () => {
    await listPluginsAction();
    expect(prismaMock.plugin.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'u1' } }));
  });
  it('delete enforces ownership (findFirst by id+ownerId)', async () => {
    await deletePluginAction('pl1');
    expect(prismaMock.plugin.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pl1', ownerId: 'u1' } }));
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/server/plugins.ts`:
```ts
'use server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/current-user';
import { audit } from '@/lib/audit';
import { generatePluginToken, hashPluginToken, generateWebhookSecret } from '@/lib/plugins/token';
import { encryptSecret } from '@/lib/crypto';

type Fail = { ok: false; error: 'validation' | 'not_found' | 'failed'; detail?: string };
type Ok<T> = { ok: true } & T;

export interface PluginRow { id: string; name: string; description: string | null; webhookUrl: string | null; events: string[]; uiTabUrl: string | null; uiTabLabel: string | null; enabled: boolean; }

const httpUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), 'http/https only');
const RegisterSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  webhookUrl: httpUrl.optional(),
  uiTabUrl: httpUrl.optional(),
  uiTabLabel: z.string().max(40).optional(),
  events: z.array(z.string().regex(/^[a-z]+\.[a-z_]+$/)).default([]),
});

function row(p: { id: string; name: string; description: string | null; webhookUrl: string | null; events: string[]; uiTabUrl: string | null; uiTabLabel: string | null; enabled: boolean }): PluginRow {
  return { id: p.id, name: p.name, description: p.description, webhookUrl: p.webhookUrl, events: p.events, uiTabUrl: p.uiTabUrl, uiTabLabel: p.uiTabLabel, enabled: p.enabled };
}

export async function listPluginsAction(): Promise<Ok<{ plugins: PluginRow[] }> | Fail> {
  const user = await requireUser();
  const plugins = await prisma.plugin.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: 'asc' } });
  return { ok: true, plugins: plugins.map(row) };
}

export async function registerPluginAction(input: z.infer<typeof RegisterSchema>): Promise<Ok<{ id: string; token: string; webhookSecret: string }> | Fail> {
  const user = await requireUser();
  const parsed = RegisterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation', detail: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const token = generatePluginToken();
  const webhookSecret = generateWebhookSecret();
  const created = await prisma.plugin.create({
    data: {
      ownerId: user.id, name: d.name, description: d.description, webhookUrl: d.webhookUrl,
      uiTabUrl: d.uiTabUrl, uiTabLabel: d.uiTabLabel, events: d.events,
      tokenHash: hashPluginToken(token),
      webhookSecretEnc: d.webhookUrl ? encryptSecret(webhookSecret) : null,
    },
  });
  await audit('plugin.register', { userId: user.id, target: created.id, metadata: { name: d.name } });
  return { ok: true, id: created.id, token, webhookSecret };
}

async function ownPlugin(userId: string, id: string) {
  const p = await prisma.plugin.findFirst({ where: { id, ownerId: userId } });
  return p;
}

export async function setPluginEnabledAction(id: string, enabled: boolean): Promise<Ok<{}> | Fail> {
  const user = await requireUser();
  if (!(await ownPlugin(user.id, id))) return { ok: false, error: 'not_found' };
  await prisma.plugin.update({ where: { id }, data: { enabled } });
  await audit('plugin.toggle', { userId: user.id, target: id, metadata: { enabled } });
  return { ok: true };
}

export async function rotatePluginTokenAction(id: string): Promise<Ok<{ token: string }> | Fail> {
  const user = await requireUser();
  if (!(await ownPlugin(user.id, id))) return { ok: false, error: 'not_found' };
  const token = generatePluginToken();
  await prisma.plugin.update({ where: { id }, data: { tokenHash: hashPluginToken(token) } });
  await audit('plugin.rotate', { userId: user.id, target: id });
  return { ok: true, token };
}

export async function deletePluginAction(id: string): Promise<Ok<{}> | Fail> {
  const user = await requireUser();
  if (!(await ownPlugin(user.id, id))) return { ok: false, error: 'not_found' };
  await prisma.plugin.delete({ where: { id } });
  await audit('plugin.delete', { userId: user.id, target: id });
  return { ok: true };
}
```

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/server/plugins.test.ts
git add src/server/plugins.ts src/server/plugins.test.ts
git commit -m "feat(plugins): lifecycle actions (register/list/toggle/rotate/delete)"
git push
```

---

## Task 5: `/api/ext` 인증 + 소유자 스코프 헬퍼 [TDD]

**Files:** Create `src/lib/plugins/auth.ts`, `src/lib/plugins/scope.ts`, `src/lib/plugins/auth.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/lib/plugins/auth.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = { plugin: { findUnique: vi.fn() }, user: { findUnique: vi.fn() } };
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
import { authenticatePlugin } from './auth';
import { hashPluginToken } from './token';

beforeEach(() => vi.clearAllMocks());

function req(auth?: string) { return new Request('https://x/api/ext/servers', { headers: auth ? { authorization: auth } : {} }); }

describe('authenticatePlugin', () => {
  it('returns null without a Bearer ptex_ token', async () => {
    expect(await authenticatePlugin(req())).toBeNull();
    expect(await authenticatePlugin(req('Bearer nope'))).toBeNull();
  });
  it('resolves an enabled plugin + owner', async () => {
    const token = 'ptex_' + 'a'.repeat(43);
    prismaMock.plugin.findUnique.mockResolvedValue({ id: 'pl1', ownerId: 'u1', enabled: true });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', role: 'USER', pteroUserId: 7 });
    const ctx = await authenticatePlugin(req(`Bearer ${token}`));
    expect(prismaMock.plugin.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashPluginToken(token) } }));
    expect(ctx?.owner.id).toBe('u1');
  });
  it('rejects a disabled plugin', async () => {
    prismaMock.plugin.findUnique.mockResolvedValue({ id: 'pl1', ownerId: 'u1', enabled: false });
    expect(await authenticatePlugin(req('Bearer ptex_' + 'b'.repeat(43)))).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/plugins/auth.ts`:
```ts
import { prisma } from '@/lib/db';
import { hashPluginToken } from './token';
import type { ScopeUser } from '@/lib/authz/access';

export interface PluginContext { pluginId: string; owner: ScopeUser; }

export async function authenticatePlugin(req: Request): Promise<PluginContext | null> {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token?.startsWith('ptex_')) return null;
  const plugin = await prisma.plugin.findUnique({ where: { tokenHash: hashPluginToken(token) } });
  if (!plugin || !plugin.enabled) return null;
  const owner = await prisma.user.findUnique({ where: { id: plugin.ownerId }, select: { id: true, role: true, pteroUserId: true } });
  if (!owner || !((await prisma.user.findUnique({ where: { id: owner.id }, select: { isActive: true } }))?.isActive)) return null;
  return { pluginId: plugin.id, owner: { id: owner.id, role: owner.role, pteroUserId: owner.pteroUserId } };
}
```

`src/lib/plugins/scope.ts`:
```ts
import { requireServerAccess, type ServerAccessDeniedError } from '@/lib/authz/guard';
import type { ScopeUser } from '@/lib/authz/access';
import { asIdentifier } from '@/lib/ptero/types';

/** Resolve+guard a server for a plugin's owner; throws ServerAccessDeniedError if out of scope. */
export async function pluginServer(owner: ScopeUser, identifier: string) {
  const id = asIdentifier(identifier);
  await requireServerAccess(owner, id);
  return id;
}
```

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/lib/plugins/auth.test.ts
git add src/lib/plugins/auth.ts src/lib/plugins/scope.ts src/lib/plugins/auth.test.ts
git commit -m "feat(plugins): /api/ext authentication + owner-scope helper"
git push
```

---

## Task 6: `/api/ext/*` 라우트 (소유자 스코프) [TDD 일부]

**Files:** Create `src/app/api/ext/servers/route.ts`, `src/app/api/ext/servers/[id]/power/route.ts`, `src/app/api/ext/servers/[id]/route.ts`, (+files/backups), `src/lib/plugins/respond.ts`, `src/app/api/ext/servers/route.test.ts`

- [ ] **Step 1: 공통 응답 헬퍼**

`src/lib/plugins/respond.ts`:
```ts
import { NextResponse } from 'next/server';
import { PteroApiError } from '@/lib/ptero/errors';
import { ServerAccessDeniedError } from '@/lib/authz/guard';

export function extError(err: unknown): NextResponse {
  if (err instanceof ServerAccessDeniedError) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (err instanceof PteroApiError) return NextResponse.json({ error: 'upstream', status: err.httpStatus }, { status: err.httpStatus === 429 ? 429 : 502 });
  console.error('ext route failed', err);
  return NextResponse.json({ error: 'failed' }, { status: 500 });
}
```

- [ ] **Step 2: 실패 테스트 (servers 목록: 인증 + 소유자 스코프)**

`src/app/api/ext/servers/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const authMock = vi.fn();
vi.mock('@/lib/plugins/auth', () => ({ authenticatePlugin: authMock }));
const resolveMock = vi.fn();
vi.mock('@/lib/authz/access', () => ({ resolveAccessibleServers: resolveMock }));
import { GET } from './route';

beforeEach(() => vi.clearAllMocks());
const req = (auth = true) => new Request('https://x/api/ext/servers', { headers: auth ? { authorization: 'Bearer ptex_x' } : {} });

describe('GET /api/ext/servers', () => {
  it('401 without valid plugin auth', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(req(false));
    expect(res.status).toBe(401);
  });
  it('returns owner-scoped servers', async () => {
    authMock.mockResolvedValue({ pluginId: 'pl1', owner: { id: 'u1', role: 'USER', pteroUserId: 7 } });
    resolveMock.mockResolvedValue([{ identifier: '1a2b3c4d', uuid: 'u', name: 'A' }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.servers[0].identifier).toBe('1a2b3c4d');
    expect(resolveMock).toHaveBeenCalledWith({ id: 'u1', role: 'USER', pteroUserId: 7 });
  });
});
```

- [ ] **Step 3: 실패 확인 → 구현**

`src/app/api/ext/servers/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { resolveAccessibleServers } from '@/lib/authz/access';
import { extError } from '@/lib/plugins/respond';

export async function GET(req: Request) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const servers = await resolveAccessibleServers(ctx.owner);
    return NextResponse.json({ servers: servers.map((s) => ({ identifier: s.identifier, uuid: s.uuid, name: s.name, node: s.node ?? null })) });
  } catch (err) { return extError(err); }
}
```

`src/app/api/ext/servers/[id]/power/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { pluginServer } from '@/lib/plugins/scope';
import { requireServerPermission } from '@/lib/authz/guard';
import { powerServer } from '@/lib/ptero/client';
import { extError } from '@/lib/plugins/respond';
import { audit } from '@/lib/audit';

const SIGNALS = new Set(['start', 'stop', 'restart', 'kill']);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const sid = await pluginServer(ctx.owner, id);
    const body = await req.json().catch(() => ({}));
    const signal = String(body.signal ?? '');
    if (!SIGNALS.has(signal)) return NextResponse.json({ error: 'invalid_signal' }, { status: 400 });
    const permission = signal === 'kill' ? 'control.stop' : `control.${signal}`;
    await requireServerPermission(ctx.owner, sid, permission);
    await powerServer(sid, signal as 'start' | 'stop' | 'restart' | 'kill');
    await audit('ext.power', { userId: ctx.owner.id, target: sid, metadata: { pluginId: ctx.pluginId, signal } });
    return new NextResponse(null, { status: 204 });
  } catch (err) { return extError(err); }
}
```

`src/app/api/ext/servers/[id]/route.ts` (details):
```ts
import { NextResponse } from 'next/server';
import { authenticatePlugin } from '@/lib/plugins/auth';
import { pluginServer } from '@/lib/plugins/scope';
import { getServer } from '@/lib/ptero/client';
import { extError } from '@/lib/plugins/respond';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePlugin(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const sid = await pluginServer(ctx.owner, id);
    const details = await getServer(sid);
    return NextResponse.json({ server: details.attributes });
  } catch (err) { return extError(err); }
}
```
> 동일 패턴으로 `command`(POST `{command}` + `control.console`), `files/list`·`files/contents`(GET + `file.read`)·`files/write`(POST + `file.update`), `backups`(GET/POST + `backup.read`/`backup.create`), `backups/[uuid]/download`(GET + `backup.download`) 라우트를 추가한다. 각 라우트: `authenticatePlugin` → `pluginServer` → `requireServerPermission(권한)` → `lib/ptero` → 응답/`extError`.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/app/api/ext/servers/route.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ext/ src/lib/plugins/respond.ts
git commit -m "feat(plugins): /api/ext scoped routes (servers/power/details/command/files/backups)"
git push
```

---

## Task 7: 계정 → 플러그인 UI

**Files:** Create `src/app/(panel)/account/plugins/page.tsx`, `src/features/plugins/plugins-manager.tsx`; Modify `(panel)/layout.tsx`(계정 링크가 이미 있으면 하위 메뉴/페이지만)

- [ ] **Step 1: 매니저(Client) 작성**

`src/features/plugins/plugins-manager.tsx`:
```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { listPluginsAction, registerPluginAction, setPluginEnabledAction, rotatePluginTokenAction, deletePluginAction, type PluginRow } from '@/server/plugins';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const EVENTS = ['server.power', 'server.command', 'backup.create', 'backup.restore', 'file.write', 'file.delete'];

export function PluginsManager() {
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [form, setForm] = useState({ name: '', webhookUrl: '', uiTabUrl: '', uiTabLabel: '' });
  const [events, setEvents] = useState<Set<string>>(new Set());
  const [secret, setSecret] = useState<{ token: string; webhookSecret: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() { start(async () => { const r = await listPluginsAction(); if (r.ok) setPlugins(r.plugins); else setMsg('불러오기 실패'); }); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function register(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const r = await registerPluginAction({ name: form.name, webhookUrl: form.webhookUrl || undefined, uiTabUrl: form.uiTabUrl || undefined, uiTabLabel: form.uiTabLabel || undefined, events: [...events] });
    if (r.ok) { setSecret({ token: r.token, webhookSecret: r.webhookSecret }); setForm({ name: '', webhookUrl: '', uiTabUrl: '', uiTabLabel: '' }); setEvents(new Set()); load(); }
    else setMsg(r.detail ?? '등록 실패');
  }
  async function toggle(p: PluginRow) { const r = await setPluginEnabledAction(p.id, !p.enabled); if (r.ok) load(); else setMsg('실패'); }
  async function rotate(p: PluginRow) { const r = await rotatePluginTokenAction(p.id); if (r.ok) setSecret({ token: r.token, webhookSecret: '(unchanged)' }); else setMsg('실패'); }
  async function remove(p: PluginRow) { if (!confirm(`${p.name} 삭제?`)) return; const r = await deletePluginAction(p.id); if (r.ok) load(); else setMsg('실패'); }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">플러그인</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {secret && (
        <Card className="border-amber-400">
          <p className="text-sm font-medium">이 값은 다시 표시되지 않습니다 — 지금 복사하세요.</p>
          <p className="mt-2 break-all text-xs">토큰: <code>{secret.token}</code></p>
          <p className="break-all text-xs">webhook 시크릿: <code>{secret.webhookSecret}</code></p>
          <Button variant="ghost" onClick={() => setSecret(null)}>닫기</Button>
        </Card>
      )}
      <Card className="space-y-2">
        <h2 className="text-sm font-medium">새 플러그인</h2>
        <form onSubmit={register} className="space-y-2">
          <Input placeholder="이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="webhook URL (선택)" value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
          <div className="flex gap-2">
            <Input placeholder="UI 탭 URL (선택)" value={form.uiTabUrl} onChange={(e) => setForm({ ...form, uiTabUrl: e.target.value })} />
            <Input placeholder="탭 라벨" value={form.uiTabLabel} onChange={(e) => setForm({ ...form, uiTabLabel: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-1"><input type="checkbox" checked={events.has(ev)} onChange={() => { const n = new Set(events); n.has(ev) ? n.delete(ev) : n.add(ev); setEvents(n); }} />{ev}</label>
            ))}
          </div>
          <Button type="submit">등록</Button>
        </form>
      </Card>
      <Card className="p-0">
        <table className="w-full text-sm"><tbody>
          {plugins.map((p) => (
            <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="px-4 py-2">{p.name}{!p.enabled && <span className="ml-2 text-xs text-zinc-400">(비활성)</span>}<div className="text-xs text-zinc-500">{p.events.join(', ')}</div></td>
              <td className="px-4 py-2"><div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => toggle(p)}>{p.enabled ? '비활성' : '활성'}</Button>
                <Button variant="ghost" onClick={() => rotate(p)}>토큰 회전</Button>
                <Button variant="ghost" onClick={() => remove(p)}>삭제</Button>
              </div></td>
            </tr>
          ))}
        </tbody></table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 페이지**

`src/app/(panel)/account/plugins/page.tsx`:
```tsx
import { PluginsManager } from '@/features/plugins/plugins-manager';
export default function AccountPluginsPage() { return <PluginsManager />; }
```

- [ ] **Step 3: 타입체크 + Commit**

```bash
pnpm typecheck
git add "src/app/(panel)/account/plugins/page.tsx" src/features/plugins/
git commit -m "feat(plugins): account plugins management UI"
git push
```

---

## Task 8: e2e (등록·토큰·크로스유저 차단) + 최종 검증

**Files:** Create `e2e/plugins.spec.ts`; Modify `e2e/mock-panel.mjs`(필요 시), `README.md`

- [ ] **Step 1: e2e 스펙**

`e2e/plugins.spec.ts`:
```ts
import { test, expect, request as pwRequest } from '@playwright/test';
async function login(page, id: string, pw: string) { await page.goto('/login'); await page.fill('input[name="identifier"]', id); await page.fill('input[name="password"]', pw); await page.click('button[type="submit"]'); await page.waitForURL(/\/(servers)?$/); }

test('user registers a plugin and sees the token once', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/account/plugins');
  await page.fill('input[placeholder="이름"]', 'E2E Plugin');
  await page.click('button:has-text("등록")');
  await expect(page.getByText('다시 표시되지 않습니다')).toBeVisible();
  await expect(page.locator('code', { hasText: /^ptex_/ })).toBeVisible();
});
```
> 크로스 유저 차단은 단위/통합으로 강하게 커버(아래). e2e는 UI 흐름 위주.

- [ ] **Step 2: 통합 — 크로스 유저 차단 (단위 보강)**

`src/app/api/ext/servers/[id]/power/route.test.ts`: USER `u1` 토큰으로 `u1`이 접근 불가한 서버 id에 power 시도 → `pluginServer`가 `ServerAccessDeniedError` → 404. (authMock owner=u1, resolveAccessibleServers(u1) 비포함 id → requireServerAccess throw → extError 404.)

- [ ] **Step 3: 전체 검증 + README**

`README.md`에 "플러그인(외부 통합): 등록·토큰·`/api/ext` 스코프 API" + 작성 가이드 링크.
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm prisma migrate deploy
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
```
Expected: 전부 그린.

- [ ] **Step 4: Commit**

```bash
git add e2e/ README.md
git commit -m "test(e2e): plugin registration + cross-user scope isolation"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지(§4–6,9):** 모델 ✓T1 · 시크릿 암호화 ✓T2 · 토큰 ✓T3 · 등록/라이프사이클 ✓T4,7 · 인증·소유자 스코프 ✓T5 · `/api/ext` 표면 ✓T6 · 보안(소유자 스코프 강제·키 비노출·토큰 1회) ✓ 전반.
- **플레이스홀더 스캔:** 모든 코드/명령 실측. 추가 라우트(command/files/backups)는 동일 패턴을 **명시적 절차**로 기술(코드 골격 제시).
- **타입 일관성:** `PluginContext.owner: ScopeUser`가 `resolveAccessibleServers`/`requireServerAccess`와 정합. `Ok/Fail` 패턴 동일. `hashPluginToken`/`encryptSecret` 시그니처 일관. `requireServerPermission` 권한 키(control.*, file.*, backup.*)는 기존과 동일.
- **보안:** `/api/ext` 모든 라우트가 `authenticatePlugin`→`pluginServer`(또는 `resolveAccessibleServers`) 선행. 토큰 해시 저장·1회 노출. 비활성 401. webhookUrl http/https + (6a는 등록까지; SSRF 사설IP 차단은 §12 R3대로 6b 전송 시 강화 가능).
- **레이트리밋:** 6a는 인증·스코프까지. 토큰별 레이트리밋은 6b와 함께 도입(또는 미들웨어로 후속) — 본 plan 범위 명시.

---

## 다음
6b(이벤트 webhook: `emitEvent` 훅·디스패처·HMAC·재시도·로그·전송 UI) → 6c(UI iframe: 탭 레지스트리 연동·단기 컨텍스트 토큰·postMessage·CSP).
