import { afterAll, afterEach, beforeAll } from 'vitest';
import { mswServer } from './src/test/msw/server';

process.env.PANEL_URL ??= 'https://panel.test';
process.env.PTERO_APP_KEY ??= 'ptla_test';
process.env.PTERO_CLIENT_KEY ??= 'ptlc_test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
process.env.SESSION_SECRET ??= 'test-session-secret-value';
process.env.APP_BASE_URL ??= 'http://localhost:3000';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
