import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

function listenForWebhook(): Promise<{
  close: () => Promise<void>;
  received: Promise<{
    body: string;
    headers: {
      event: string | undefined;
      signature: string | undefined;
      timestamp: string | undefined;
    };
  }>;
  url: string;
}> {
  let server: Server;
  const received = new Promise<{
    body: string;
    headers: {
      event: string | undefined;
      signature: string | undefined;
      timestamp: string | undefined;
    };
  }>((resolve) => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      resolve({
        body,
        headers: {
          event: req.headers['x-pteron-event']?.toString(),
          signature: req.headers['x-pteron-signature']?.toString(),
          timestamp: req.headers['x-pteron-timestamp']?.toString(),
        },
      });
      res.writeHead(204);
      res.end();
    });
  });

  return new Promise((resolve) => {
    server = server!;
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind webhook receiver');
      }
      resolve({
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
        received,
        url: `http://127.0.0.1:${address.port}/webhook`,
      });
    });
  });
}

test('plugin receives signed server.power webhook', async ({ page }) => {
  const receiver = await listenForWebhook();
  try {
    await login(page, 'user', 'user-pass');
    await page.goto('/account/plugins');
    await page.fill('input[placeholder="이름"]', 'Webhook E2E Plugin');
    await page.fill('input[placeholder="webhook URL (선택)"]', receiver.url);
    await page.getByLabel('server.power').check();
    await page.click('button:has-text("등록")');

    await expect(page.getByText('다시 표시되지 않습니다')).toBeVisible();
    const webhookSecret = (await page.locator('code').nth(1).textContent()) ?? '';
    expect(webhookSecret).toMatch(/^[0-9a-f]{64}$/);

    await page.goto('/servers/1a2b3c4d');
    await page.getByRole('button', { name: '재시작' }).click();

    const request = await receiver.received;
    expect(request.headers.event).toBe('server.power');
    expect(request.headers.timestamp).toBeTruthy();
    expect(request.headers.signature).toBe(
      'sha256=' +
        createHmac('sha256', webhookSecret)
          .update(`${request.headers.timestamp}.${request.body}`)
          .digest('hex'),
    );

    const payload = JSON.parse(request.body);
    expect(payload).toMatchObject({
      event: 'server.power',
      server: '1a2b3c4d',
      data: { signal: 'restart' },
    });
  } finally {
    await receiver.close();
  }
});
