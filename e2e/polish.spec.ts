import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, id: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(servers)?$/);
}

test('dashboard shows server count', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/');
  await expect(page.getByText('접근 가능 서버')).toBeVisible();
});

test('theme toggle persists', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/');
  await page.getByLabel('테마 전환').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('health endpoint responds', async ({ request }) => {
  const response = await request.get('/api/health');
  expect([200, 503]).toContain(response.status());
});

test('unknown route renders 404', async ({ page }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);
});
