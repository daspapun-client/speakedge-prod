import { APIRequestContext, APIResponse, expect } from '@playwright/test';

/** The standard response envelope every SpeakEdge module returns. */
export type Envelope<T = unknown> = {
  success: boolean;
  data: T;
  message: string | null;
  error: { code: string; message: string; status: number; details?: unknown } | null;
};

type Body = Record<string, unknown> | unknown[];
type CallOptions = {
  data?: Body;
  params?: Record<string, string | number | boolean>;
  multipart?: Record<string, unknown>;
  headers?: Record<string, string>;
};

/**
 * Thin wrapper over Playwright's APIRequestContext that:
 *  - prefixes every path with /api/v1
 *  - attaches the bearer token for the current role
 *  - asserts HTTP 2xx AND envelope.success, then returns `data`
 *
 * Create one instance per role (admin/student/...) around the same request
 * context; tokens are independent.
 */
export class ApiClient {
  private token: string | null = null;

  constructor(
    private readonly request: APIRequestContext,
    private readonly prefix = '/api/v1',
  ) {}

  setToken(token: string | null): this {
    this.token = token;
    return this;
  }

  private url(path: string): string {
    return `${this.prefix}${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  /** Perform the raw HTTP call and return the untouched APIResponse. */
  async raw(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    opts: CallOptions = {},
  ): Promise<APIResponse> {
    const fn = (this.request[method] as (u: string, o?: unknown) => Promise<APIResponse>).bind(
      this.request,
    );
    return fn(this.url(path), {
      headers: this.headers(opts.headers),
      data: opts.data,
      params: opts.params,
      multipart: opts.multipart,
    });
  }

  /** Call an endpoint, assert the envelope contract, and return `data`. */
  private async call<T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    opts: CallOptions = {},
  ): Promise<T> {
    const res = await this.raw(method, path, opts);
    const status = res.status();
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const label = `${method.toUpperCase()} ${path} -> ${status}`;
    expect(res.ok(), `${label}\n${JSON.stringify(body, null, 2)}`).toBeTruthy();
    const env = body as Envelope<T>;
    expect(env.success, `${label} returned success=false\n${JSON.stringify(body, null, 2)}`).toBe(
      true,
    );
    return env.data;
  }

  get<T = any>(path: string, opts?: CallOptions) {
    return this.call<T>('get', path, opts);
  }
  post<T = any>(path: string, opts?: CallOptions) {
    return this.call<T>('post', path, opts);
  }
  put<T = any>(path: string, opts?: CallOptions) {
    return this.call<T>('put', path, opts);
  }
  patch<T = any>(path: string, opts?: CallOptions) {
    return this.call<T>('patch', path, opts);
  }
  del<T = any>(path: string, opts?: CallOptions) {
    return this.call<T>('delete', path, opts);
  }

  /** Authenticate and store the access token on this client. */
  async login(username: string, password: string): Promise<string> {
    const data = await this.post<{ access_token: string; role: string; subject: string }>(
      '/auth/login',
      { data: { username, password } },
    );
    expect(data.access_token, 'login returned no access_token').toBeTruthy();
    this.setToken(data.access_token);
    return data.access_token;
  }
}

/** Convenience factory: a client bound to `request` with an optional token. */
export function client(request: APIRequestContext, token?: string | null): ApiClient {
  const c = new ApiClient(request);
  if (token) c.setToken(token);
  return c;
}
