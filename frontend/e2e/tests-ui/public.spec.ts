import { test, expect } from '@playwright/test';
import { uid } from '../tests/helpers/data';

/**
 * Browser UI automation of the public (unauthenticated) React pages.
 * Run headed with:  npx playwright test --project=ui --headed
 */
test.describe('Public site (UI)', () => {
  test('home page renders hero + primary nav', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /confidence, for life/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Activate your book' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
  });

  test('navigate to Subscription plans and see live plan cards', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Subscription', exact: true }).click();
    await expect(page).toHaveURL(/\/plans$/);
    await expect(page.getByRole('heading', { name: 'Subscription Plans' })).toBeVisible();
    // Plans are fetched from GET /payments/plans through the proxy.
    await expect(page.getByRole('heading', { name: 'Tribe', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Subscribe' }).first()).toBeVisible();
  });

  test('booking a free demo shows the success confirmation', async ({ page }) => {
    await page.goto('/demo');
    await expect(page.getByRole('heading', { name: 'Book a Free Demo' })).toBeVisible();
    const inputs = page.locator('form input');
    await inputs.nth(0).fill(`UI Demo ${uid()}`); // Full name
    await inputs.nth(1).fill('9800000009'); // Phone
    await inputs.nth(2).fill(`ui_${uid()}@example.com`); // Email (empty string fails EmailStr)
    await page.getByRole('button', { name: 'Request Demo' }).click();
    await expect(page.getByRole('heading', { name: /Thank you/ })).toBeVisible();
  });

  test('verify page reports an unknown code as not found', async ({ page }) => {
    await page.goto('/verify');
    await page.getByPlaceholder(/CERT-/).fill(`CERT-${uid(10).toUpperCase()}`);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText(/Verification failed/i)).toBeVisible();
  });

  test('subscribing while logged out redirects to login', async ({ page }) => {
    await page.goto('/plans');
    await page.getByRole('button', { name: 'Subscribe' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
