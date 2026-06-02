import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

test('USER sees databases tab', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/servers/1a2b3c4d/databases');
  await expect(page.getByText('s1_default')).toBeVisible();
});

test('USER sees network allocation', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/servers/1a2b3c4d/network');
  await expect(page.getByText('25565')).toBeVisible();
});

test('USER sees startup variable', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/servers/1a2b3c4d/startup');
  await expect(page.getByText('MC_VERSION')).toBeVisible();
});

test('detail tab on non-owned server is 404', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  const response = await page.goto('/servers/9z9z9z9z/databases');
  expect(response?.status()).toBe(404);
});
