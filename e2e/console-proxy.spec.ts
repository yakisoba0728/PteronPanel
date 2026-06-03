import { expect, test, type Page } from '@playwright/test';

const RESTRICTED_SERVER = '6f6f6f6f';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

async function logout(page: Page) {
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.waitForURL('**/login');
}

async function syncSubuserAccess(page: Page) {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin');
  await page.getByRole('button', { name: '서브유저 접근 동기화' }).click();
  await expect(page.getByText(/동기화 완료/)).toBeVisible();
  await logout(page);
}

async function resetWsEvents(page: Page) {
  const response = await page.request.post('http://127.0.0.1:9099/ws-events/reset');
  expect(response.ok()).toBe(true);
}

async function wsEvents(page: Page): Promise<Array<{ event: string; args?: string[] }>> {
  const response = await page.request.get('http://127.0.0.1:9099/ws-events');
  const body = (await response.json()) as { events: Array<{ event: string; args?: string[] }> };
  return body.events;
}

function hasFrame(
  events: Array<{ event: string; args?: string[] }>,
  event: string,
  args: string[] = [],
): boolean {
  return events.some(
    (frame) => frame.event === event && JSON.stringify(frame.args ?? []) === JSON.stringify(args),
  );
}

test('proxy blocks unauthorized subuser power and command frames before Wings', async ({ page }) => {
  await resetWsEvents(page);
  await syncSubuserAccess(page);

  await login(page, 'user', 'user-pass');
  await expect(page.getByText('Restricted Server')).toBeVisible();

  const browserRequests: string[] = [];
  const browserWsUrls: string[] = [];
  page.on('request', (request) => browserRequests.push(request.url()));
  page.on('websocket', (ws) => browserWsUrls.push(ws.url()));

  const messages = await page.evaluate(async (identifier) => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/console/ws?server=${encodeURIComponent(identifier)}`;
    const ws = new WebSocket(url);
    const received: Array<{ event: string; args?: string[] }> = [];

    await new Promise<void>((resolve, reject) => {
      let resolved = false;
      const timeout = window.setTimeout(() => {
        if (resolved) return;
        resolved = true;
        ws.close();
        reject(new Error(`Timed out waiting for proxy responses: ${JSON.stringify(received)}`));
      }, 5000);

      ws.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data)) as { event: string; args?: string[] };
        received.push(frame);

        if (frame.event === 'auth success') {
          ws.send(JSON.stringify({ event: 'send stats', args: [] }));
          ws.send(JSON.stringify({ event: 'set state', args: ['start'] }));
          ws.send(JSON.stringify({ event: 'send command', args: ['say hi'] }));
        }

        const daemonErrors = received.filter((item) => item.event === 'daemon error').length;
        const sawStats = received.some((item) => item.event === 'stats');
        if (daemonErrors >= 2 && sawStats && !resolved) {
          resolved = true;
          window.clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.addEventListener('error', () => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timeout);
        reject(new Error(`Proxy websocket errored: ${JSON.stringify(received)}`));
      });
    });

    return received;
  }, RESTRICTED_SERVER);

  expect(browserWsUrls).toContain(
    `ws://127.0.0.1:3000/api/console/ws?server=${RESTRICTED_SERVER}`,
  );
  expect(
    browserRequests.some((url) => /\/api\/client\/servers\/[^/]+\/websocket/.test(url)),
  ).toBe(false);
  expect(messages.filter((message) => message.event === 'daemon error')).toHaveLength(2);

  await expect
    .poll(async () => hasFrame(await wsEvents(page), 'send stats'))
    .toBe(true);

  const events = await wsEvents(page);
  expect(hasFrame(events, 'set state', ['start'])).toBe(false);
  expect(hasFrame(events, 'send command', ['say hi'])).toBe(false);
});
