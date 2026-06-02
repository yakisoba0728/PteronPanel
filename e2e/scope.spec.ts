import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

test('USER sees only owned servers and cannot reach others', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await expect(page.getByText('User Server')).toBeVisible();
  await expect(page.getByText('Other Server')).toHaveCount(0);

  const response = await page.goto('/servers/9z9z9z9z');
  expect(response?.status()).toBe(404);
});

test('ADMIN sees all servers', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await expect(page.getByText('User Server')).toBeVisible();
  await expect(page.getByText('Other Server')).toBeVisible();
});

test('console page renders the terminal for an accessible server', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/servers/1a2b3c4d/console');
  await expect(page.locator('.xterm')).toBeVisible();
  await expect(page.getByText('CPU 2.5%')).toBeVisible();
  await page.getByPlaceholder('콘솔 명령어 입력…').fill('say hello');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '재시작' }).click();
  await expect
    .poll(async () => (await page.request.get('http://127.0.0.1:9099/ws-events')).json())
    .toMatchObject({ events: expect.arrayContaining([{ event: 'send command', args: ['say hello'] }]) });
  await expect
    .poll(async () => (await page.request.get('http://127.0.0.1:9099/ws-events')).json())
    .toMatchObject({ events: expect.arrayContaining([{ event: 'set state', args: ['restart'] }]) });
});
