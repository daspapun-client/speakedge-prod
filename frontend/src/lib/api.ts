import axios, { AxiosError } from 'axios';
import { useAuth } from '@/lib/auth';

// Envelope contract shared with the backend.
export interface Envelope<T = unknown> {
  success: boolean;
  data: T;
  message?: string | null;
  error?: { code: string; message: string; details?: unknown; status?: number } | null;
}

export const api = axios.create({ baseURL: '/api/v1' });

// Attach access token.
api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401 once, then retry.
let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      if (!refreshing) refreshing = useAuth.getState().refresh();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      useAuth.getState().logout();
    }
    return Promise.reject(error);
  },
);

/** Unwrap the envelope, throwing a readable message on failure. */
export async function unwrap<T>(p: Promise<{ data: Envelope<T> }>): Promise<T> {
  try {
    const res = await p;
    return res.data.data;
  } catch (e) {
    const err = e as AxiosError<Envelope>;
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    throw new Error(msg);
  }
}
