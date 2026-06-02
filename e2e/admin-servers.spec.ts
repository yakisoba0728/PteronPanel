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

test('admin can open the create wizard and see egg options', async ({
  page,
}) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin/servers/new');
  await expect(page.getByRole('heading', { name: '서버 생성' })).toBeVisible();
  await expect(page.locator('select').nth(1)).toBeVisible();
  await expect(page.locator('select').nth(1)).toContainText('Nest 선택');
});
