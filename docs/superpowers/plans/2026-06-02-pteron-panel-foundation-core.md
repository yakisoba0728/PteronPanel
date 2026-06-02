# Pteron Panel — Foundation Core 구현 계획 (Plan 1/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pteron Panel의 기반 — 프로젝트 스캐폴딩, 환경설정, DB(Prisma), 그리고 **Pterodactyl Panel API 클라이언트 레이어**(타입·에러·HTTP 코어·Application/Client 래퍼)를 단위/통합 테스트와 함께 구축한다. UI·인증은 다루지 않는다(Plan 2·3).

**Architecture:** Next.js(App Router, TS) 단일 앱. 모든 외부 호출은 `src/lib/ptero/*`의 순수 함수형 래퍼를 통하며, 이 레이어는 인가를 모른다(인가는 Plan 2). 식별자는 branded type으로 3종 분리해 컴파일 타임에 혼용을 막는다. HTTP 코어가 에러 정규화·429 백오프·타임아웃·페이지네이션을 단일 지점에서 처리한다.

**Tech Stack:** Next.js 15 · React 19 · TypeScript(strict) · Prisma 6 + PostgreSQL · zod · pnpm · Vitest + MSW(v2) · Tailwind v4. 참조 spec: `docs/superpowers/specs/2026-06-02-pteron-panel-design.md`(특히 §9, 부록 A).

> **표준 작업 규칙(이 저장소):** 각 Task의 마지막 "Commit" 스텝에서 **commit 후 반드시 `git push origin main`** 한다. 커밋 메시지에 **AI 워터마크(Co-Authored-By 등) 금지**.

---

## File Structure (Plan 1 범위)

| 파일 | 책임 |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `vitest.setup.ts` | 툴링·빌드 설정 |
| `tailwind.config.ts`, `postcss.config.mjs`, `src/app/globals.css` | 스타일 기반 |
| `.env.example`, `.nvmrc`, `.gitignore`(갱신) | 환경·무시 목록 |
| `docker-compose.dev.yml` | 로컬/테스트용 PostgreSQL |
| `src/app/layout.tsx`, `src/app/page.tsx` | 최소 루트(스모크용, Plan 3에서 교체) |
| `src/lib/config.ts` | env 검증(zod) — 유일하게 `process.env` 읽음 |
| `prisma/schema.prisma`, `src/lib/db.ts` | DB 스키마·Prisma 싱글턴 |
| `src/lib/ptero/types.ts` | branded 식별자 + envelope/응답 타입 |
| `src/lib/ptero/errors.ts` | `PteroApiError` + envelope 파서 |
| `src/lib/ptero/http.ts` | fetch 코어(헤더·정규화·429·타임아웃·페이지네이션) |
| `src/lib/ptero/application.ts` | Application API 래퍼(숫자 id) |
| `src/lib/ptero/client.ts` | Client API 래퍼(identifier/uuid) |
| `src/test/msw/*` | MSW 핸들러·서버 |

---

## Task 1: 프로젝트 스캐폴딩 + 툴링

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `.nvmrc`, `.env.example`, `vitest.config.ts`, `vitest.setup.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/test/smoke.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: corepack/pnpm 활성화 및 Node 버전 고정**

Run:
```bash
corepack enable
node -v   # v20.x 이상 확인
printf 'v20\n' > .nvmrc
```

- [ ] **Step 2: `package.json` 작성**

`package.json`:
```json
{
  "name": "pteron-panel",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.8",
    "@prisma/client": "^6.1.0",
    "@node-rs/argon2": "^2.0.2",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.5"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "@types/node": "^22.10.1",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.1",
    "prisma": "^6.1.0",
    "tsx": "^4.19.2",
    "vitest": "^2.1.8",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "msw": "^2.7.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "postcss": "^8.4.49",
    "eslint": "^9.16.0",
    "eslint-config-next": "^15.1.0"
  }
}
```

- [ ] **Step 3: TypeScript·Next·Tailwind·PostCSS 설정 작성**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
};
export default nextConfig;
```

`postcss.config.mjs`:
```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
} satisfies Config;
```

- [ ] **Step 4: 최소 앱 루트와 글로벌 스타일 작성**

`src/app/globals.css`:
```css
@import "tailwindcss";
```

`src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Pteron Panel' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function Home() {
  return <main className="p-8 text-lg">Pteron Panel — bootstrapping…</main>;
}
```

- [ ] **Step 5: Vitest 설정 작성**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
```

`vitest.setup.ts`:
```ts
// Per-suite setup is added in later tasks (MSW). Intentionally minimal for now.
export {};
```

- [ ] **Step 6: `.env.example`, `.gitignore` 작성**

`.env.example`:
```bash
# Pterodactyl Panel
PANEL_URL="https://panel.example.com"
PTERO_APP_KEY="ptla_xxxxxxxxxxxxxxxxxxxxxxxx"     # Application API key (Admin → Application API)
PTERO_CLIENT_KEY="ptlc_xxxxxxxxxxxxxxxxxxxxxxxx"  # Client API key of a ROOT ADMIN user (Account → API Credentials)

# Database
DATABASE_URL="postgresql://pteron:pteron@localhost:5432/pteron?schema=public"

# App
SESSION_SECRET="change-me-min-16-chars"
APP_BASE_URL="http://localhost:3000"
SESSION_TTL_HOURS="12"
LOG_LEVEL="info"
```

`.gitignore` 에 다음을 추가(기존 내용 유지):
```
node_modules/
.next/
.env
.env.local
coverage/
/prisma/*.db
next-env.d.ts
```

- [ ] **Step 7: 의존성 설치 + 스모크 테스트 작성**

Run:
```bash
pnpm install
```

`src/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('toolchain smoke', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: 스모크 테스트와 타입체크 실행**

Run:
```bash
pnpm test && pnpm typecheck
```
Expected: 스모크 테스트 PASS, 타입 에러 없음.

- [ ] **Step 9: Commit + Push**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with TS, Tailwind, Vitest tooling"
git push origin main
```

---

## Task 2: 환경설정 모듈 `config.ts` (zod) [TDD]

**Files:**
- Create: `src/lib/config.ts`, `src/lib/config.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseConfig } from './config';

const valid = {
  PANEL_URL: 'https://panel.example.com',
  PTERO_APP_KEY: 'ptla_abc',
  PTERO_CLIENT_KEY: 'ptlc_abc',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SESSION_SECRET: 'a-very-long-secret-value',
  APP_BASE_URL: 'http://localhost:3000',
} as NodeJS.ProcessEnv;

describe('parseConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const cfg = parseConfig(valid);
    expect(cfg.PANEL_URL).toBe('https://panel.example.com');
    expect(cfg.SESSION_TTL_HOURS).toBe(12); // default
    expect(cfg.LOG_LEVEL).toBe('info');     // default
  });

  it('throws with a readable message when PANEL_URL is missing', () => {
    const { PANEL_URL, ...rest } = valid;
    expect(() => parseConfig(rest as NodeJS.ProcessEnv)).toThrow(/PANEL_URL/);
  });

  it('rejects a too-short SESSION_SECRET', () => {
    expect(() => parseConfig({ ...valid, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/config.test.ts`
Expected: FAIL ("Cannot find module './config'" 또는 `parseConfig` 미정의).

- [ ] **Step 3: `config.ts` 구현**

`src/lib/config.ts`:
```ts
import { z } from 'zod';

const EnvSchema = z.object({
  PANEL_URL: z.string().url(),
  PTERO_APP_KEY: z.string().min(1),
  PTERO_CLIENT_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  APP_BASE_URL: z.string().url(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  return (cached ??= parseConfig());
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/config.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/config.ts src/lib/config.test.ts
git commit -m "feat(config): zod-validated environment configuration"
git push origin main
```

---

## Task 3: Prisma 스키마 + DB 싱글턴 + 로컬 Postgres

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `docker-compose.dev.yml`, `src/lib/db.test.ts`

- [ ] **Step 1: 로컬/테스트용 Postgres 컴포즈 작성**

`docker-compose.dev.yml`:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: pteron
      POSTGRES_PASSWORD: pteron
      POSTGRES_DB: pteron
    ports:
      - "5432:5432"
    volumes:
      - pteron_pgdata:/var/lib/postgresql/data
volumes:
  pteron_pgdata:
```

- [ ] **Step 2: Prisma 스키마 작성**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  USER
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  username     String   @unique
  passwordHash String
  role         Role     @default(USER)
  pteroUserId  Int?     @unique
  pteroUuid    String?  @unique
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  sessions     Session[]
  auditLogs    AuditLog[]
}

model Session {
  id         String   @id @default(cuid())
  tokenHash  String   @unique
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())
  ip         String?
  userAgent  String?

  @@index([userId])
}

model AuditLog {
  id        String   @id @default(cuid())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id])
  action    String
  target    String?
  metadata  Json?
  ip        String?
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
}
```

- [ ] **Step 3: DB 기동 + 마이그레이션 생성**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d db
# .env 가 없다면 .env.example 을 복사해 DATABASE_URL 을 로컬 값으로 둔다
cp -n .env.example .env || true
pnpm db:generate
pnpm prisma migrate dev --name init
```
Expected: `prisma/migrations/<ts>_init/` 생성, 클라이언트 생성 성공.

- [ ] **Step 4: Prisma 싱글턴 작성**

`src/lib/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

- [ ] **Step 5: 통합 스모크 테스트 작성**

> 이 테스트는 로컬 Postgres(`docker compose -f docker-compose.dev.yml up -d db`)가 떠 있어야 한다. `DATABASE_URL` 이 설정돼 있어야 한다.

`src/lib/db.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from './db';

describe('prisma client (integration)', () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'dbtest@example.com' } });
    await prisma.$disconnect();
  });

  it('creates and reads a user', async () => {
    const created = await prisma.user.create({
      data: {
        email: 'dbtest@example.com',
        username: 'dbtest',
        passwordHash: 'x',
        role: 'USER',
      },
    });
    const found = await prisma.user.findUnique({ where: { id: created.id } });
    expect(found?.email).toBe('dbtest@example.com');
    expect(found?.role).toBe('USER');
  });
});
```

- [ ] **Step 6: 테스트 실행**

Run: `pnpm vitest run src/lib/db.test.ts`
Expected: PASS (DB 연결·생성·조회 성공).

- [ ] **Step 7: Commit + Push**

```bash
git add prisma/ src/lib/db.ts src/lib/db.test.ts docker-compose.dev.yml
git commit -m "feat(db): Prisma schema (User/Session/AuditLog) + client singleton"
git push origin main
```

---

## Task 4: Pterodactyl 타입·식별자·에러 [TDD]

**Files:**
- Create: `src/lib/ptero/types.ts`, `src/lib/ptero/errors.ts`, `src/lib/ptero/ptero.types.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/ptero/ptero.types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { asIdentifier, asUuid } from './types';
import { PteroApiError, parsePteroErrors } from './errors';

describe('branded identifiers', () => {
  it('accepts a valid 8-char identifier', () => {
    expect(asIdentifier('1a2b3c4d')).toBe('1a2b3c4d');
  });
  it('rejects a non-8-char identifier', () => {
    expect(() => asIdentifier('short')).toThrow(/identifier/i);
  });
  it('accepts a valid uuid and rejects garbage', () => {
    expect(asUuid('1a2b3c4d-5e6f-7081-9234-567890abcdef')).toMatch(/^1a2b3c4d/);
    expect(() => asUuid('not-a-uuid')).toThrow(/uuid/i);
  });
});

describe('ptero errors', () => {
  it('parses the error envelope and surfaces the first detail', () => {
    const body = {
      errors: [{ code: 'NotFoundHttpException', status: '404', detail: 'Not found.' }],
    };
    const details = parsePteroErrors(body);
    const err = new PteroApiError(404, details, 'req-123');
    expect(err.httpStatus).toBe(404);
    expect(err.message).toBe('Not found.');
    expect(err.requestId).toBe('req-123');
  });
  it('returns [] for a non-envelope body', () => {
    expect(parsePteroErrors('oops')).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/ptero/ptero.types.test.ts`
Expected: FAIL (모듈/심볼 미정의).

- [ ] **Step 3: `types.ts` 구현**

`src/lib/ptero/types.ts`:
```ts
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ServerNumericId = Brand<number, 'ServerNumericId'>;
export type ServerIdentifier = Brand<string, 'ServerIdentifier'>; // 8-char uuidShort
export type ServerUuid = Brand<string, 'ServerUuid'>;             // 36-char uuid

export const asNumericId = (n: number): ServerNumericId => n as ServerNumericId;

export function asIdentifier(value: string): ServerIdentifier {
  if (value.length !== 8) {
    throw new Error(`Invalid server identifier (expected 8 chars, got ${value.length}): ${value}`);
  }
  return value as ServerIdentifier;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function asUuid(value: string): ServerUuid {
  if (!UUID_RE.test(value)) throw new Error(`Invalid server uuid: ${value}`);
  return value as ServerUuid;
}

// --- Response envelopes (Pterodactyl Fractal) ---
export interface PteroItem<A> {
  object: string;
  attributes: A;
  relationships?: Record<string, unknown>;
}
export interface Pagination {
  total: number;
  count: number;
  per_page: number;
  current_page: number;
  total_pages: number;
}
export interface PteroList<A> {
  object: 'list';
  data: PteroItem<A>[];
  meta: { pagination: Pagination };
}

// --- Domain shapes used across the app ---
export interface AccessibleServer {
  identifier: ServerIdentifier;
  uuid: ServerUuid;
  numericId?: ServerNumericId;
  name: string;
  node?: string;
}

export interface ServerResources {
  current_state: string;
  is_suspended: boolean;
  memory_bytes: number;
  cpu_absolute: number;
  disk_bytes: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  uptime: number;
}

export interface WebsocketCredentials {
  token: string;
  socket: string;
}

export type PowerSignal = 'start' | 'stop' | 'restart' | 'kill';
```

- [ ] **Step 4: `errors.ts` 구현**

`src/lib/ptero/errors.ts`:
```ts
export interface PteroErrorDetail {
  code: string;
  status: string;
  detail: string;
  source?: { field?: string };
}

export class PteroApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errors: PteroErrorDetail[],
    readonly requestId?: string,
  ) {
    super(errors[0]?.detail ?? `Pterodactyl API error (HTTP ${httpStatus})`);
    this.name = 'PteroApiError';
  }
  get primary(): PteroErrorDetail | undefined {
    return this.errors[0];
  }
  get field(): string | undefined {
    return this.errors[0]?.source?.field;
  }
}

export function parsePteroErrors(body: unknown): PteroErrorDetail[] {
  if (body && typeof body === 'object' && Array.isArray((body as { errors?: unknown }).errors)) {
    return (body as { errors: PteroErrorDetail[] }).errors;
  }
  return [];
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/ptero/ptero.types.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 6: Commit + Push**

```bash
git add src/lib/ptero/types.ts src/lib/ptero/errors.ts src/lib/ptero/ptero.types.test.ts
git commit -m "feat(ptero): branded server identifiers, response envelopes, PteroApiError"
git push origin main
```

---

## Task 5: HTTP 코어 `http.ts` + MSW 인프라 [TDD]

**Files:**
- Create: `src/test/msw/server.ts`, `src/lib/ptero/http.ts`, `src/lib/ptero/http.test.ts`
- Modify: `vitest.setup.ts`

- [ ] **Step 1: MSW 서버 + 글로벌 setup 작성**

`src/test/msw/server.ts`:
```ts
import { setupServer } from 'msw/node';
export const mswServer = setupServer();
```

`vitest.setup.ts` (교체):
```ts
import { afterAll, afterEach, beforeAll } from 'vitest';
import { mswServer } from './src/test/msw/server';

// Test env defaults so getConfig()/pteroFetch() work without a real .env.
process.env.PANEL_URL ??= 'https://panel.test';
process.env.PTERO_APP_KEY ??= 'ptla_test';
process.env.PTERO_CLIENT_KEY ??= 'ptlc_test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
process.env.SESSION_SECRET ??= 'test-session-secret-value';
process.env.APP_BASE_URL ??= 'http://localhost:3000';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
```

> 참고: `src/lib/db.test.ts`(실 DB 통합)는 `onUnhandledRequest:'error'` 와 무관(HTTP 아님). DB 미가동 환경에서는 `pnpm vitest run --exclude '**/db.test.ts'` 로 제외 가능. CI 문서화는 Plan 3 README에서.

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/ptero/http.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { pteroFetch } from './http';
import { PteroApiError } from './errors';
import type { PteroItem } from './types';

const BASE = 'https://panel.test/api';

describe('pteroFetch', () => {
  it('sends Bearer auth + Accept and returns parsed JSON (application)', async () => {
    let seenAuth = '';
    mswServer.use(
      http.get(`${BASE}/application/users/1`, ({ request }) => {
        seenAuth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({ object: 'user', attributes: { id: 1, email: 'a@b.c' } });
      }),
    );
    const res = await pteroFetch<PteroItem<{ id: number; email: string }>>('application', '/users/1');
    expect(res.attributes.email).toBe('a@b.c');
    expect(seenAuth).toBe('Bearer ptla_test');
  });

  it('uses the client key for the client API', async () => {
    let seenAuth = '';
    mswServer.use(
      http.get(`${BASE}/client/servers/1a2b3c4d`, ({ request }) => {
        seenAuth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({ object: 'server', attributes: { identifier: '1a2b3c4d' } });
      }),
    );
    await pteroFetch('client', '/servers/1a2b3c4d');
    expect(seenAuth).toBe('Bearer ptlc_test');
  });

  it('throws PteroApiError on a 404 error envelope', async () => {
    mswServer.use(
      http.get(`${BASE}/application/users/999`, () =>
        HttpResponse.json(
          { errors: [{ code: 'NotFoundHttpException', status: '404', detail: 'Not found.' }] },
          { status: 404 },
        ),
      ),
    );
    await expect(pteroFetch('application', '/users/999')).rejects.toMatchObject({
      name: 'PteroApiError',
      httpStatus: 404,
    });
  });

  it('retries once on 429 then succeeds', async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${BASE}/application/servers`, () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '0' } });
        return HttpResponse.json({ object: 'list', data: [], meta: { pagination: { total: 0, count: 0, per_page: 50, current_page: 1, total_pages: 1 } } });
      }),
    );
    const res = await pteroFetch('application', '/servers');
    expect(calls).toBe(2);
    expect(res).toMatchObject({ object: 'list' });
  });

  it('serializes JSON bodies and sets Content-Type on POST', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/client/servers/1a2b3c4d/power`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await pteroFetch('client', '/servers/1a2b3c4d/power', { method: 'POST', body: { signal: 'start' } });
    expect(body).toEqual({ signal: 'start' });
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/ptero/http.test.ts`
Expected: FAIL (`pteroFetch` 미정의).

- [ ] **Step 4: `http.ts` 구현**

`src/lib/ptero/http.ts`:
```ts
import { getConfig } from '@/lib/config';
import { PteroApiError, parsePteroErrors } from './errors';

type Api = 'application' | 'client';

export interface FetchOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  retries?: number;
}

function buildUrl(panelUrl: string, api: Api, path: string, query?: FetchOpts['query']): string {
  const url = new URL(`${panelUrl.replace(/\/$/, '')}/api/${api}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return secs * 1000;
  }
  return Math.min(2000, 250 * 2 ** attempt); // exponential backoff fallback
}

export async function pteroFetch<T = unknown>(api: Api, path: string, opts: FetchOpts = {}): Promise<T> {
  const cfg = getConfig();
  const key = api === 'application' ? cfg.PTERO_APP_KEY : cfg.PTERO_CLIENT_KEY;
  const url = buildUrl(cfg.PANEL_URL, api, path, opts.query);
  const method = opts.method ?? 'GET';
  const maxRetries = opts.retries ?? (method === 'GET' ? 2 : 0);
  const timeoutMs = opts.timeoutMs ?? 15000;

  for (let attempt = 0; ; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ac.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 && attempt < maxRetries) {
        await sleep(retryAfterMs(res, attempt));
        continue;
      }

      const text = await res.text();
      const json = text ? JSON.parse(text) : undefined;

      if (!res.ok) {
        throw new PteroApiError(res.status, parsePteroErrors(json), res.headers.get('x-request-id') ?? undefined);
      }
      return json as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof PteroApiError) throw err;
      const retryable = method === 'GET' && attempt < maxRetries;
      if (retryable) {
        await sleep(Math.min(2000, 250 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/ptero/http.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 6: Commit + Push**

```bash
git add src/lib/ptero/http.ts src/lib/ptero/http.test.ts src/test/msw/server.ts vitest.setup.ts
git commit -m "feat(ptero): HTTP core with error normalization, 429 backoff, timeout"
git push origin main
```

---

## Task 6: Application API 래퍼 `application.ts` [TDD]

**Files:**
- Create: `src/lib/ptero/application.ts`, `src/lib/ptero/application.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/ptero/application.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { getOwnedServers, paginateAll } from './application';

const BASE = 'https://panel.test/api/application';

describe('application.getOwnedServers', () => {
  it('maps a user\'s owned servers (include=servers) to AccessibleServer[]', async () => {
    mswServer.use(
      http.get(`${BASE}/users/7`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('include')).toBe('servers');
        return HttpResponse.json({
          object: 'user',
          attributes: {
            id: 7,
            relationships: {
              servers: {
                object: 'list',
                data: [
                  {
                    object: 'server',
                    attributes: {
                      id: 12,
                      identifier: '1a2b3c4d',
                      uuid: '1a2b3c4d-5e6f-7081-9234-567890abcdef',
                      name: 'Alpha',
                    },
                  },
                ],
              },
            },
          },
        });
      }),
    );
    const servers = await getOwnedServers(7);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ identifier: '1a2b3c4d', name: 'Alpha', numericId: 12 });
  });
});

describe('paginateAll', () => {
  it('iterates every page until total_pages', async () => {
    let page = 0;
    const fetchPage = async (p: number) => {
      page = p;
      return {
        object: 'list' as const,
        data: [{ object: 'x', attributes: { n: p } }],
        meta: { pagination: { total: 2, count: 1, per_page: 1, current_page: p, total_pages: 2 } },
      };
    };
    const all = await paginateAll(fetchPage);
    expect(all.map((i) => i.attributes.n)).toEqual([1, 2]);
    expect(page).toBe(2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/ptero/application.test.ts`
Expected: FAIL (`getOwnedServers`/`paginateAll` 미정의).

- [ ] **Step 3: `application.ts` 구현**

`src/lib/ptero/application.ts`:
```ts
import { pteroFetch } from './http';
import {
  asIdentifier,
  asNumericId,
  asUuid,
  type AccessibleServer,
  type PteroItem,
  type PteroList,
} from './types';

interface AppServerAttrs {
  id: number;
  identifier: string;
  uuid: string;
  name: string;
  node?: number;
}

function toAccessible(a: AppServerAttrs): AccessibleServer {
  return {
    identifier: asIdentifier(a.identifier),
    uuid: asUuid(a.uuid),
    numericId: asNumericId(a.id),
    name: a.name,
  };
}

/** A user's OWNED servers via /users/{id}?include=servers (owner_id based). */
export async function getOwnedServers(pteroUserId: number): Promise<AccessibleServer[]> {
  const res = await pteroFetch<
    PteroItem<{ relationships?: { servers?: PteroList<AppServerAttrs> } }>
  >('application', `/users/${pteroUserId}`, { query: { include: 'servers' } });
  const list = res.attributes.relationships?.servers?.data ?? [];
  return list.map((item) => toAccessible(item.attributes));
}

/** Generic paginator: calls fetchPage(1..total_pages) and concatenates data items. */
export async function paginateAll<A>(
  fetchPage: (page: number) => Promise<PteroList<A>>,
): Promise<PteroItem<A>[]> {
  const first = await fetchPage(1);
  const out: PteroItem<A>[] = [...first.data];
  const totalPages = first.meta.pagination.total_pages;
  for (let p = 2; p <= totalPages; p += 1) {
    const next = await fetchPage(p);
    out.push(...next.data);
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/ptero/application.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/ptero/application.ts src/lib/ptero/application.test.ts
git commit -m "feat(ptero): application API wrapper (owned servers, paginateAll)"
git push origin main
```

---

## Task 7: Client API 래퍼 `client.ts` [TDD]

**Files:**
- Create: `src/lib/ptero/client.ts`, `src/lib/ptero/client.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/ptero/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listServers, getResources, powerServer, getWebsocketCredentials } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';

describe('client.listServers', () => {
  it('passes ?type=admin-all and maps results', async () => {
    mswServer.use(
      http.get(`${BASE}/`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('type')).toBe('admin-all');
        return HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server',
              attributes: {
                identifier: '1a2b3c4d',
                internal_id: 12,
                uuid: '1a2b3c4d-5e6f-7081-9234-567890abcdef',
                name: 'Alpha',
              },
            },
          ],
          meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } },
        });
      }),
    );
    const servers = await listServers('admin-all');
    expect(servers[0]).toMatchObject({ identifier: '1a2b3c4d', name: 'Alpha' });
  });
});

describe('client.getResources', () => {
  it('flattens the stats envelope', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/resources`, () =>
        HttpResponse.json({
          object: 'stats',
          attributes: {
            current_state: 'running',
            is_suspended: false,
            resources: {
              memory_bytes: 100,
              cpu_absolute: 1.5,
              disk_bytes: 200,
              network_rx_bytes: 1,
              network_tx_bytes: 2,
              uptime: 3000,
            },
          },
        }),
      ),
    );
    const r = await getResources(asIdentifier('1a2b3c4d'));
    expect(r).toMatchObject({ current_state: 'running', memory_bytes: 100, cpu_absolute: 1.5 });
  });
});

describe('client.powerServer', () => {
  it('POSTs { signal }', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/power`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await powerServer(asIdentifier('1a2b3c4d'), 'restart');
    expect(body).toEqual({ signal: 'restart' });
  });
});

describe('client.getWebsocketCredentials', () => {
  it('returns { token, socket }', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/websocket`, () =>
        HttpResponse.json({ data: { token: 'jwt-x', socket: 'wss://node:8080/api/servers/uuid/ws' } }),
      ),
    );
    const creds = await getWebsocketCredentials(asIdentifier('1a2b3c4d'));
    expect(creds).toEqual({ token: 'jwt-x', socket: 'wss://node:8080/api/servers/uuid/ws' });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/ptero/client.test.ts`
Expected: FAIL (심볼 미정의).

- [ ] **Step 3: `client.ts` 구현**

`src/lib/ptero/client.ts`:
```ts
import { pteroFetch } from './http';
import {
  asIdentifier,
  asNumericId,
  asUuid,
  type AccessibleServer,
  type PowerSignal,
  type PteroItem,
  type PteroList,
  type ServerIdentifier,
  type ServerResources,
  type WebsocketCredentials,
} from './types';

export type ClientListType = 'admin-all' | 'owner' | undefined;

interface ClientServerAttrs {
  identifier: string;
  internal_id?: number;
  uuid: string;
  name: string;
  node?: string;
}

function toAccessible(a: ClientServerAttrs): AccessibleServer {
  return {
    identifier: asIdentifier(a.identifier),
    uuid: asUuid(a.uuid),
    numericId: a.internal_id !== undefined ? asNumericId(a.internal_id) : undefined,
    name: a.name,
    node: a.node,
  };
}

/** GET /api/client?type=... — for a root-admin key, 'admin-all' returns every server. */
export async function listServers(type: ClientListType = undefined): Promise<AccessibleServer[]> {
  const res = await pteroFetch<PteroList<ClientServerAttrs>>('client', '/', {
    query: { type, per_page: 100 },
  });
  return res.data.map((item) => toAccessible(item.attributes));
}

interface StatsEnvelope {
  attributes: {
    current_state: string;
    is_suspended: boolean;
    resources: {
      memory_bytes: number;
      cpu_absolute: number;
      disk_bytes: number;
      network_rx_bytes: number;
      network_tx_bytes: number;
      uptime: number;
    };
  };
}

export async function getResources(id: ServerIdentifier): Promise<ServerResources> {
  const res = await pteroFetch<StatsEnvelope>('client', `/servers/${id}/resources`);
  return { current_state: res.attributes.current_state, is_suspended: res.attributes.is_suspended, ...res.attributes.resources };
}

export async function getServer(id: ServerIdentifier): Promise<PteroItem<ClientServerAttrs & Record<string, unknown>>> {
  return pteroFetch('client', `/servers/${id}`);
}

export async function powerServer(id: ServerIdentifier, signal: PowerSignal): Promise<void> {
  await pteroFetch('client', `/servers/${id}/power`, { method: 'POST', body: { signal } });
}

export async function sendCommand(id: ServerIdentifier, command: string): Promise<void> {
  await pteroFetch('client', `/servers/${id}/command`, { method: 'POST', body: { command } });
}

export async function getWebsocketCredentials(id: ServerIdentifier): Promise<WebsocketCredentials> {
  const res = await pteroFetch<{ data: WebsocketCredentials }>('client', `/servers/${id}/websocket`);
  return res.data;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/ptero/client.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: 전체 테스트·타입체크·린트 게이트**

Run:
```bash
pnpm vitest run --exclude '**/db.test.ts' && pnpm typecheck && pnpm lint
```
Expected: 모든 단위 테스트 PASS, 타입·린트 그린. (DB 통합 테스트는 Postgres 가동 시 별도 실행.)

- [ ] **Step 6: Commit + Push**

```bash
git add src/lib/ptero/client.ts src/lib/ptero/client.test.ts
git commit -m "feat(ptero): client API wrapper (list/resources/power/command/websocket)"
git push origin main
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지(§9, 부록 A 대비):** config(§7) ✓ Task2 · DB 스키마(§6) ✓ Task3 · branded 식별자(§4.5) ✓ Task4 · 에러 정규화(§9.1) ✓ Task4–5 · 429 백오프(§4.4) ✓ Task5 · Application 소유서버 열거(§4.1, 부록 A.6) ✓ Task6 · Client admin-all/power/command/websocket(부록 A.3) ✓ Task7. **인가·세션·UI는 의도적으로 Plan 2·3로 이연.**
- **플레이스홀더 스캔:** 모든 코드 스텝에 실제 코드/명령 포함, TBD 없음.
- **타입 일관성:** `AccessibleServer`(types.ts)를 application/client가 동일하게 생성. `ServerIdentifier`/`ServerUuid`/`ServerNumericId` 시그니처 일관. `pteroFetch` 시그니처가 application/client에서 동일하게 사용됨. `PowerSignal` 값(start/stop/restart/kill) 일관.
- **알려진 환경 의존:** `db.test.ts`는 로컬 Postgres 필요(문서화됨, 게이트에서 제외 옵션 제공).

---

## 다음 계획

- **Plan 2 — Auth & Authz:** argon2 해시, 세션(opaque 토큰+`Session`), `requireUser()`, 미들웨어, `resolveAccessibleServers`(+캐시), `requireServerAccess`, seed.
- **Plan 3 — Client Slice:** 앱 셸·디자인 시스템, 로그인 UI, 서버 목록, 개요/전원, **콘솔(WS 매니저 + xterm)**, Playwright e2e, Dockerfile/compose, README(두 키·Wings `allowed_origins`).
