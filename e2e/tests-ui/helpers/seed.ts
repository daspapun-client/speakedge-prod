import { request as pwRequest } from '@playwright/test';
import { ApiClient } from '../../tests/helpers/api';
import { SEED, membershipForm } from '../../tests/helpers/data';

/**
 * UI tests drive the browser, but some flows (e.g. student login) need an
 * account to already exist. We create one straight through the API so the
 * browser test can focus on the UI. This talks to API_BASE_URL directly
 * (not through the Vite proxy).
 */
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8000';

export async function seedApprovedStudent(): Promise<{ studentId: string; password: string }> {
  const ctx = await pwRequest.newContext({ baseURL: API_BASE_URL });
  try {
    const admin = new ApiClient(ctx);
    await admin.login(SEED.admin.username, SEED.admin.password);

    const gen = await admin.post<{ codes: string[] }>('/activation-codes/generate', {
      data: { count: 1 },
    });
    const code = gen.codes[0];
    const password = 'Student@123';

    await new ApiClient(ctx).post('/membership/activate', {
      multipart: membershipForm(code, password),
    });
    await admin.post(`/membership/${code}/approve`);

    return { studentId: code, password };
  } finally {
    await ctx.dispose();
  }
}
