import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

test('USER sees schedules', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/servers/1a2b3c4d/schedules');
  await expect(page.getByText('Nightly Backup')).toBeVisible();
  await expect(page.getByText('#1 backup:')).toBeVisible();
});

test('schedules tab on non-owned server is 404', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  const response = await page.goto('/servers/9z9z9z9z/schedules');
  expect(response?.status()).toBe(404);
});
