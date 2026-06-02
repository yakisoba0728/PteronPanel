import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

function listenForPluginUi(): Promise<{ close: () => Promise<void>; url: string }> {
  let server: Server;
  return new Promise((resolve) => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`
        <!doctype html>
        <html>
          <body>
            <main id="plugin-root">Plugin iframe UI</main>
            <script>
              window.addEventListener('message', (event) => {
                if (event.data?.type === 'pteron:context') {
                  document.body.dataset.context = 'received';
                }
              });
            </script>
          </body>
        </html>
      `);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind plugin UI receiver');
      }

      resolve({
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
        url: `http://127.0.0.1:${address.port}/plugin-ui`,
      });
    });
  });
}

test('user sees a registered plugin iframe tab on a server view', async ({ page }) => {
  const pluginUi = await listenForPluginUi();
  const label = `Iframe E2E ${Date.now()}`;

  try {
    await login(page, 'user', 'user-pass');
    await page.goto('/account/plugins');
    await page.fill('input[placeholder="이름"]', label);
    await page.fill('input[placeholder="UI 탭 URL (선택)"]', pluginUi.url);
    await page.fill('input[placeholder="탭 라벨"]', label);
    await page.click('button:has-text("등록")');
    await expect(page.getByText('다시 표시되지 않습니다')).toBeVisible();

    await page.goto('/servers/1a2b3c4d');
    await page.getByRole('link', { name: label }).click();

    await expect(page).toHaveURL(new RegExp(`/servers/1a2b3c4d/plugin/.+`));
    await expect(page.locator('iframe[title="plugin"]')).toBeVisible();
    await expect(page.locator('iframe[title="plugin"]')).toHaveAttribute('src', pluginUi.url);
  } finally {
    await pluginUi.close();
  }
});
