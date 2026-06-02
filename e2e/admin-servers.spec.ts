import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, id: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

test('admin sees server list', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin/servers');
  await expect(page.getByText('User Server')).toBeVisible();
});

test('admin can create a server through the wizard', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin/servers/new');
  await expect(page.getByRole('heading', { name: '서버 생성' })).toBeVisible();

  await page.getByPlaceholder('서버 이름').fill('E2E Server');

  const selects = page.locator('select');
  await selects.nth(0).selectOption('7');
  await selects.nth(1).selectOption('1');
  await expect(selects.nth(2)).toContainText('Paper');
  await selects.nth(2).selectOption('5');

  await expect(page.getByText('Version (MC_VERSION)')).toBeVisible();
  await selects.nth(3).selectOption('1');

  await expect(page.getByRole('button', { name: '서버 생성' })).toBeEnabled();
  await page.getByRole('button', { name: '서버 생성' }).click();

  await page.waitForURL('**/admin/servers');
  await expect(page.getByText('E2E Server')).toBeVisible();
});
