import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
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
  const response = await page.goto('/servers/9z9z9z9z/files');
  expect(response?.status()).toBe(404);
});
