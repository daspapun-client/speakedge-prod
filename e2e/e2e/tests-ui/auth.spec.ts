import { test, expect, Page } from '@playwright/test';
import { SEED } from '../tests/helpers/data';
import { seedApprovedStudent } from './helpers/seed';

/** Fill and submit the login form. */
async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder(/SPK-26/).fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('Authenticated flows (UI)', () => {
  test('admin logs in, sees overview, navigates, and logs out', async ({ page }) => {
    await signIn(page, SEED.admin.username, SEED.admin.password);

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Dashboard Overview' })).toBeVisible();
    await expect(page.getByText('Total Students')).toBeVisible();

    // Sidebar navigation into the Activation Codes admin screen.
    await page.getByRole('link', { name: 'Activation Codes' }).click();
    await expect(page).toHaveURL(/\/admin\/codes$/);

    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a verified student logs in and reaches their dashboard', async ({ page }) => {
    const { studentId, password } = await seedApprovedStudent();

    await signIn(page, studentId, password);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /Welcome,/ })).toBeVisible();
    await expect(page.getByText(`Student ID: ${studentId}`)).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
  });
});
