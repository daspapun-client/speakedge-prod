import { test, expect } from '@playwright/test';

/** Sanity checks that the API is up and reachable before the journey runs. */
test.describe('Health', () => {
  test('GET /health is alive', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.ok(), `Backend not reachable at baseURL (status ${res.status()})`).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('alive');
  });

  test('GET /health/ready reports DB connectivity', async ({ request }) => {
    const res = await request.get('/health/ready');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.db, 'MongoDB is not connected — seed + start the backend first').toBe(true);
  });
});
