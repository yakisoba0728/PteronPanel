import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(servers)?$/);
}

test('user registers a plugin and sees the token once', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/account/plugins');
  await page.fill('input[placeholder="이름"]', 'E2E Plugin');
  await page.click('button:has-text("등록")');

  await expect(page.getByText('다시 표시되지 않습니다')).toBeVisible();
  await expect(page.locator('code').filter({ hasText: /^ptex_/ })).toBeVisible();
});
