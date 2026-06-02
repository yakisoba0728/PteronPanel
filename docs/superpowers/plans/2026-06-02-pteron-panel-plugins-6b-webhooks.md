# Pteron Panel — Plugins 6b: Event Webhooks 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 패널 발생 동작을 구독 플러그인의 webhook으로 **HMAC 서명** 전송한다 — `emitEvent` 훅, 소유자 스코프 디스패처, 서명, 백오프 재시도, `WebhookDelivery` 로그 + 수동 재시도 UI.

**Architecture:** 기존 액션(전원·백업·파일 등)에 `emitEvent(type, {serverIdentifier, actorUserId, data})`를 `audit()`와 병행 호출. 디스패처는 **이벤트 대상 서버에 접근 가능한 소유자의** 구독·활성·webhookUrl 플러그인을 찾아(소유자별 `resolveAccessibleServers` 1회) 서명 POST를 백그라운드로 전송하고 로그를 남긴다.

**Tech Stack:** Node `crypto`(HMAC) · `fetch` · Prisma(`WebhookDelivery`) · Vitest+MSW. **선행:** 6a 완료(`Plugin`/`WebhookDelivery`·`decryptSecret`·`resolveAccessibleServers`). 참조 spec §7,9,12.

> **표준 규칙:** 각 Task commit + push. **AI 워터마크 금지.** **워크트리**에서 작업.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/plugins/webhook.ts` | 서명(`signWebhook`)·전송(`deliverWebhook`, 재시도) |
| `src/lib/plugins/events.ts` | `emitEvent` + 디스패처(타깃 선택·로그·비동기 전송) |
| `src/server/*`(수정) | 기존 액션에 `emitEvent` 훅 |
| `src/server/plugins.ts`(수정) | 전송 로그 조회·수동 재시도 액션 |
| `src/features/plugins/deliveries.tsx` | 전송 로그 UI |
| `e2e/plugin-webhooks.spec.ts` | e2e(서명 webhook 수신) |

---

## Task 1: webhook 서명 + 전송 [TDD]

**Files:** Create `src/lib/plugins/webhook.ts`, `src/lib/plugins/webhook.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/lib/plugins/webhook.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signWebhook } from './webhook';

describe('signWebhook', () => {
  it('produces sha256=HMAC(secret, timestamp.body)', () => {
    const body = JSON.stringify({ event: 'server.power' });
    const ts = '1700000000';
    const sig = signWebhook('secret', ts, body);
    const expected = 'sha256=' + createHmac('sha256', 'secret').update(`${ts}.${body}`).digest('hex');
    expect(sig).toBe(expected);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/plugins/webhook.ts`:
```ts
import { createHmac } from 'node:crypto';

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export interface DeliverResult { ok: boolean; status?: number; error?: string; }

/** POST a signed webhook with bounded retries (exponential backoff). */
export async function deliverWebhook(url: string, secret: string, payload: unknown, opts: { retries?: number; timeoutMs?: number } = {}): Promise<DeliverResult> {
  const body = JSON.stringify(payload);
  const max = opts.retries ?? 2;
  for (let attempt = 0; ; attempt += 1) {
    const ts = String(Math.floor(epochSeconds()));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pteron-Event': (payload as { event?: string }).event ?? '',
          'X-Pteron-Timestamp': ts,
          'X-Pteron-Signature': signWebhook(secret, ts, body),
        },
        body,
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (res.ok) return { ok: true, status: res.status };
      if (attempt >= max) return { ok: false, status: res.status };
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= max) return { ok: false, error: err instanceof Error ? err.message : 'network' };
    }
    await sleep(Math.min(4000, 300 * 2 ** attempt));
  }
}

// injectable-ish helpers (kept simple; app runtime allows Date.now())
function epochSeconds(): number { return Date.now() / 1000; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
```

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/lib/plugins/webhook.test.ts
git add src/lib/plugins/webhook.ts src/lib/plugins/webhook.test.ts
git commit -m "feat(plugins): webhook HMAC signing + delivery with retries"
git push
```

---

## Task 2: `emitEvent` + 디스패처 [TDD]

**Files:** Create `src/lib/plugins/events.ts`, `src/lib/plugins/events.test.ts`

- [ ] **Step 1: 실패 테스트 (타깃 선택: 소유자 스코프 + 구독)**

`src/lib/plugins/events.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  plugin: { findMany: vi.fn() },
  webhookDelivery: { create: vi.fn(async () => ({ id: 'd1' })), update: vi.fn(async () => ({})) },
};
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
const resolveMock = vi.fn();
vi.mock('@/lib/authz/access', () => ({ resolveAccessibleServers: resolveMock }));
const deliverMock = vi.fn(async () => ({ ok: true, status: 200 }));
vi.mock('./webhook', () => ({ deliverWebhook: deliverMock, signWebhook: () => 'sig' }));
vi.mock('@/lib/crypto', () => ({ decryptSecret: (s: string) => `dec:${s}` }));

import { selectTargetPlugins } from './events';

beforeEach(() => vi.clearAllMocks());

describe('selectTargetPlugins', () => {
  it('includes only subscribed+enabled+webhook plugins whose owner can access the server', async () => {
    prismaMock.plugin.findMany.mockResolvedValue([
      { id: 'p1', ownerId: 'u1', webhookUrl: 'https://a', webhookSecretEnc: 'e1', events: ['server.power'] },
      { id: 'p2', ownerId: 'u2', webhookUrl: 'https://b', webhookSecretEnc: 'e2', events: ['server.power'] },
    ]);
    resolveMock.mockImplementation(async (owner: any) => owner.id === 'u1' ? [{ identifier: '1a2b3c4d' }] : [{ identifier: 'zzzzzzzz' }]);
    const targets = await selectTargetPlugins('server.power', '1a2b3c4d');
    expect(targets.map((t) => t.id)).toEqual(['p1']); // u2 cannot access 1a2b3c4d
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/plugins/events.ts`:
```ts
import { prisma } from '@/lib/db';
import { resolveAccessibleServers, type ScopeUser } from '@/lib/authz/access';
import { decryptSecret } from '@/lib/crypto';
import { deliverWebhook } from './webhook';

export interface EventPayloadInput { serverIdentifier: string; actorUserId?: string; data?: Record<string, unknown>; }

interface TargetPlugin { id: string; ownerId: string; webhookUrl: string; webhookSecretEnc: string; }

/** Plugins that should receive `event` about `serverIdentifier`: subscribed + enabled + webhookUrl + owner can access the server. */
export async function selectTargetPlugins(event: string, serverIdentifier: string): Promise<TargetPlugin[]> {
  const candidates = await prisma.plugin.findMany({
    where: { enabled: true, webhookUrl: { not: null }, events: { has: event } },
  });
  // Group by owner; resolve each owner's accessible servers once.
  const accessByOwner = new Map<string, Set<string>>();
  const out: TargetPlugin[] = [];
  for (const p of candidates) {
    if (!p.webhookUrl || !p.webhookSecretEnc) continue;
    let access = accessByOwner.get(p.ownerId);
    if (!access) {
      const owner = await prisma.user.findUnique({ where: { id: p.ownerId }, select: { id: true, role: true, pteroUserId: true } });
      const servers = owner ? await resolveAccessibleServers(owner as ScopeUser) : [];
      access = new Set(servers.map((s) => String(s.identifier)));
      accessByOwner.set(p.ownerId, access);
    }
    if (access.has(serverIdentifier)) out.push({ id: p.id, ownerId: p.ownerId, webhookUrl: p.webhookUrl, webhookSecretEnc: p.webhookSecretEnc });
  }
  return out;
}

/** Fire-and-forget: deliver `event` to all target plugins, recording WebhookDelivery rows. Never throws into the caller. */
export async function emitEvent(event: string, input: EventPayloadInput): Promise<void> {
  try {
    const targets = await selectTargetPlugins(event, input.serverIdentifier);
    await Promise.all(targets.map(async (t) => {
      const delivery = await prisma.webhookDelivery.create({ data: { pluginId: t.id, event, status: 'pending' } });
      const payload = { id: delivery.id, event, server: input.serverIdentifier, actor: input.actorUserId ?? null, data: input.data ?? {} };
      const result = await deliverWebhook(t.webhookUrl, decryptSecret(t.webhookSecretEnc), payload);
      await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: result.ok ? 'success' : 'failed', attempts: { increment: 1 }, responseCode: result.status ?? null, error: result.error ?? null } });
    }));
  } catch (err) {
    console.error('emitEvent failed', { event, err });
  }
}
```
> 호출자는 `void emitEvent(...)`로 비동기 발사(요청 경로 비차단).

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/lib/plugins/events.test.ts
git add src/lib/plugins/events.ts src/lib/plugins/events.test.ts
git commit -m "feat(plugins): emitEvent dispatcher with owner-scope target selection"
git push
```

---

## Task 3: 액션 레이어에 `emitEvent` 훅

**Files:** Modify `src/server/servers.ts`, `src/server/backups.ts`, `src/server/files.ts`

- [ ] **Step 1: 훅 추가**

각 성공 mutation에서 `audit(...)` 직후 `void emitEvent(...)`를 추가(요청 비차단). 예:
- `powerServerAction`(servers.ts): 성공 후 `void emitEvent('server.power', { serverIdentifier: id, actorUserId: user.id, data: { signal } });`
- `createBackupAction`(backups.ts): `void emitEvent('backup.create', { serverIdentifier: id, actorUserId: user.id, data: { name } });`
- `restoreBackupAction`: `'backup.restore'`
- `writeFileAction`(files.ts): `'file.write'` data `{ file }`
- `deleteFilesAction`: `'file.delete'` data `{ files }`
(상단 `import { emitEvent } from '@/lib/plugins/events';` 추가. `id`는 가드가 반환한 식별자 문자열.)

- [ ] **Step 2: 타입체크 + Commit**

```bash
pnpm typecheck
git add src/server/servers.ts src/server/backups.ts src/server/files.ts
git commit -m "feat(plugins): emit events from power/backup/file actions"
git push
```

---

## Task 4: 전송 로그 조회 + 수동 재시도 액션 [TDD]

**Files:** Modify `src/server/plugins.ts`; Create `src/server/plugins.deliveries.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/server/plugins.deliveries.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const prismaMock = {
  plugin: { findFirst: vi.fn(async () => ({ id: 'pl1', ownerId: 'u1', webhookUrl: 'https://a', webhookSecretEnc: 'e' })) },
  webhookDelivery: { findMany: vi.fn(async () => [{ id: 'd1', event: 'server.power', status: 'failed', attempts: 1, responseCode: 500, createdAt: new Date() }]), findFirst: vi.fn(async () => ({ id: 'd1', pluginId: 'pl1', event: 'server.power' })), update: vi.fn(async () => ({})) },
};
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/crypto', () => ({ decryptSecret: () => 'dec' }));
vi.mock('@/lib/plugins/webhook', () => ({ deliverWebhook: vi.fn(async () => ({ ok: true, status: 200 })) }));
let currentUser: any = { id: 'u1', role: 'USER', pteroUserId: 7 };
vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => currentUser) }));

import { listDeliveriesAction, retryDeliveryAction } from './plugins';
beforeEach(() => { currentUser = { id: 'u1', role: 'USER', pteroUserId: 7 }; vi.clearAllMocks(); });

describe('deliveries', () => {
  it('lists deliveries for an owned plugin', async () => {
    const r = await listDeliveriesAction('pl1');
    expect(r.ok && r.deliveries[0].id).toBe('d1');
    expect(prismaMock.plugin.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pl1', ownerId: 'u1' } }));
  });
  it('retries a failed delivery (ownership enforced)', async () => {
    const r = await retryDeliveryAction('pl1', 'd1');
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 (plugins.ts에 추가)**

```ts
import { decryptSecret } from '@/lib/crypto';
import { deliverWebhook } from '@/lib/plugins/webhook';

export interface DeliveryRow { id: string; event: string; status: string; attempts: number; responseCode: number | null; createdAt: string; }

export async function listDeliveriesAction(pluginId: string): Promise<Ok<{ deliveries: DeliveryRow[] }> | Fail> {
  const user = await requireUser();
  const plugin = await prisma.plugin.findFirst({ where: { id: pluginId, ownerId: user.id } });
  if (!plugin) return { ok: false, error: 'not_found' };
  const rows = await prisma.webhookDelivery.findMany({ where: { pluginId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return { ok: true, deliveries: rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, responseCode: d.responseCode, createdAt: d.createdAt.toISOString() })) };
}

export async function retryDeliveryAction(pluginId: string, deliveryId: string): Promise<Ok<{}> | Fail> {
  const user = await requireUser();
  const plugin = await prisma.plugin.findFirst({ where: { id: pluginId, ownerId: user.id } });
  if (!plugin || !plugin.webhookUrl || !plugin.webhookSecretEnc) return { ok: false, error: 'not_found' };
  const delivery = await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, pluginId } });
  if (!delivery) return { ok: false, error: 'not_found' };
  const payload = { id: delivery.id, event: delivery.event, server: null, actor: null, data: {}, retry: true };
  const result = await deliverWebhook(plugin.webhookUrl, decryptSecret(plugin.webhookSecretEnc), payload);
  await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: result.ok ? 'success' : 'failed', attempts: { increment: 1 }, responseCode: result.status ?? null, error: result.error ?? null } });
  return { ok: true };
}
```

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/server/plugins.deliveries.test.ts
git add src/server/plugins.ts src/server/plugins.deliveries.test.ts
git commit -m "feat(plugins): delivery log query + manual retry"
git push
```

---

## Task 5: 전송 로그 UI

**Files:** Create `src/features/plugins/deliveries.tsx`; Modify `src/features/plugins/plugins-manager.tsx`(플러그인별 "로그" 토글)

- [ ] **Step 1: 로그 컴포넌트**

`src/features/plugins/deliveries.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { listDeliveriesAction, retryDeliveryAction, type DeliveryRow } from '@/server/plugins';
import { Button } from '@/components/ui/button';

export function Deliveries({ pluginId }: { pluginId: string }) {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  async function load() { const r = await listDeliveriesAction(pluginId); if (r.ok) setRows(r.deliveries); else setMsg('실패'); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [pluginId]);
  async function retry(id: string) { const r = await retryDeliveryAction(pluginId, id); if (r.ok) load(); else setMsg('재시도 실패'); }
  return (
    <div className="mt-2 space-y-1 text-xs">
      {msg && <p className="text-red-600">{msg}</p>}
      {rows.length === 0 && <p className="text-zinc-400">전송 기록 없음</p>}
      {rows.map((d) => (
        <div key={d.id} className="flex items-center justify-between rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800">
          <span>{d.event} · {d.status}{d.responseCode ? ` (${d.responseCode})` : ''} · {new Date(d.createdAt).toLocaleString()}</span>
          {d.status === 'failed' && <Button variant="ghost" onClick={() => retry(d.id)}>재시도</Button>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 매니저에 "로그" 토글 연결**

`plugins-manager.tsx`의 각 플러그인 행에 "로그" 버튼 → `<Deliveries pluginId={p.id} />` 토글 표시.

- [ ] **Step 3: 타입체크 + Commit**

```bash
pnpm typecheck
git add src/features/plugins/
git commit -m "feat(plugins): webhook delivery log UI + manual retry"
git push
```

---

## Task 6: e2e (서명 webhook 수신) + 최종 검증

**Files:** Create `e2e/plugin-webhooks.spec.ts`(+ `e2e` mock 수신 서버 확장), `README.md`(작성 가이드)

- [ ] **Step 1: e2e — 서명 검증**

`e2e` mock 외부 서비스(작은 http 수신기)를 띄워, 시드된 플러그인(webhookUrl=그 수신기, events=['server.power'])이 있는 상태에서 USER가 콘솔/개요에서 전원 동작 → 수신기가 `X-Pteron-Signature`를 받고 HMAC 검증 통과를 확인. (또는 단위/통합으로 dispatcher→deliver 경로를 강하게 커버하고 e2e는 등록+로그 표시까지.)

- [ ] **Step 2: README 작성 가이드**

`README.md`에 "플러그인 webhook 수신: 서명 검증법(`X-Pteron-Signature = sha256=HMAC(secret, ts + '.' + body)`, timestamp 허용오차), 이벤트 페이로드 스키마" 추가.

- [ ] **Step 3: 전체 검증 + Commit**

```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm prisma migrate deploy
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
git add e2e/ README.md
git commit -m "test(e2e): plugin webhook signing + README author guide"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지(§7,9,12):** 서명·전송·재시도 ✓T1 · emitEvent·소유자 스코프 타깃 선택 ✓T2 · 액션 훅 ✓T3 · 전송 로그·수동 재시도 ✓T4,5 · 보안(HMAC·timestamp·소유자 필터·시크릿 복호는 서버 전용) ✓.
- **플레이스홀더 스캔:** 코드/명령 실측. e2e 수신기는 절차 명시.
- **타입 일관성:** `emitEvent`/`selectTargetPlugins` 시그니처, `deliverWebhook` 결과, `Ok/Fail`(6a와 동일), `decryptSecret`(6a) 재사용. `ScopeUser` 정합.
- **비차단:** `emitEvent`는 `void`로 발사, 내부 try/catch로 절대 액션을 깨지 않음.
- **레이트리밋/신뢰성(§12 R1/R2):** fire-and-forget + 재시도 + 로그(MVP). 큐/정확히-한-번은 후속. SSRF(§12 R3): webhookUrl은 6a 등록에서 http/https 검증; 사설 IP 차단은 본 plan에서 deliver 전 옵션 추가 가능(권장, 환경설정 플래그).

---

## 다음
6c(UI iframe: 탭 레지스트리 연동·단기 컨텍스트 토큰·postMessage·CSP)로 마무리.
