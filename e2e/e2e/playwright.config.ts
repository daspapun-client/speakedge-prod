import { defineConfig, devices } from '@playwright/test';

/**
 * SpeakEdge end-to-end config — two projects:
 *
 *   • api  — HTTP/contract tests via the `request` fixture (no browser).
 *   • ui   — real browser automation of the React app (Chromium).
 *
 * API tests need a running, seeded backend (FastAPI + MongoDB).
 * UI tests additionally need the frontend dev server (Vite) running and
 * proxying /api to that backend:
 *
 *   cd backend  && python -m app.db.seed && .\run_dev.ps1     # :8000
 *   cd frontend && npm run dev                                # :5173  (proxy -> :8000)
 *
 * Targets are configurable:
 *   API_BASE_URL   where the API lives          (default http://127.0.0.1:8000)
 *   WEB_BASE_URL   where the React app is served (default http://127.0.0.1:5173)
 *
 * Run headed:  npx playwright test --project=ui --headed
 *          or:  set HEADED=1 & npx playwright test --project=ui
 */
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8000';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:5173';
const HEADED = !!process.env.HEADED;

export default defineConfig({
  // The API journey shares state (tokens, ids) and must run in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],

  projects: [
    {
      name: 'api',
      testDir: './tests',
      use: {
        baseURL: API_BASE_URL,
        extraHTTPHeaders: { Accept: 'application/json' },
        trace: 'retain-on-failure',
      },
    },
    {
      name: 'ui',
      testDir: './tests-ui',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: WEB_BASE_URL,
        headless: !HEADED,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
      },
    },
  ],
});
