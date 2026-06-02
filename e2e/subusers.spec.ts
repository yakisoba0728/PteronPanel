import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

async function logout(page: Page) {
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.waitForURL('**/login');
}

test('USER sees subusers', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/servers/1a2b3c4d/subusers');
  await expect(page.getByText('helper@example.com')).toBeVisible();
});

test('subusers tab on non-owned server is 404', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  const response = await page.goto('/servers/9z9z9z9z/subusers');
  expect(response?.status()).toBe(404);
});

test('admin sees scope sync button', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin');
  await expect(page.getByText('서브유저 접근 동기화')).toBeVisible();
});

test('admin sync exposes subuser servers to USER scope', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await page.goto('/admin');
  await page.getByRole('button', { name: '서브유저 접근 동기화' }).click();
  await expect(page.getByText(/동기화 완료/)).toBeVisible();

  await logout(page);
  await login(page, 'user', 'user-pass');
  await expect(page.getByText('Shared Server')).toBeVisible();
});
