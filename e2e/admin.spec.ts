import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, id: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

test('admin can open users management', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin/users');
  await expect(page.getByText('유저 관리')).toBeVisible();
});

test('admin can view nodes', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin/nodes');
  await expect(page.getByText('node-01')).toBeVisible();
});

test('non-admin is redirected away from /admin', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/admin/users');
  await page.waitForURL('**/servers');
  await expect(page.getByText('유저 관리')).toHaveCount(0);
});
