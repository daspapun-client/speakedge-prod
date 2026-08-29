import axios from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'super_admin' | 'admin' | 'examiner' | 'teacher' | 'partner' | 'student';

/** Landing route for a given role after login / when a guard bounces them. */
export function homeFor(role: Role | null): string {
  switch (role) {
    case 'super_admin':
    case 'admin':
      return '/admin';
    case 'teacher':
      return '/teacher';
    case 'partner':
      return '/partner';
    case 'examiner':
      return '/examiner';
    default:
      return '/dashboard';
  }
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
  role: Role;
  subject: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  role: Role | null;
  subject: string | null;
  isAuthenticated: () => boolean;
  isAdmin: () => boolean;
  login: (username: string, password: string) => Promise<void>;
  refresh: () => Promise<string | null>;
  logout: () => void;
}

// Persisted so login survives reloads/PWA relaunch (persistent login requirement).
export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      role: null,
      subject: null,
      isAuthenticated: () => !!get().accessToken,
      isAdmin: () => get().role === 'admin' || get().role === 'super_admin',
      login: async (username, password) => {
        const res = await axios.post('/api/v1/auth/login', { username, password });
        const t = res.data.data as TokenPair;
        set({
          accessToken: t.access_token,
          refreshToken: t.refresh_token,
          role: t.role,
          subject: t.subject,
        });
      },
      refresh: async () => {
        const rt = get().refreshToken;
        if (!rt) return null;
        try {
          const res = await axios.post('/api/v1/auth/refresh', { refresh_token: rt });
          const t = res.data.data as TokenPair;
          set({ accessToken: t.access_token, refreshToken: t.refresh_token, role: t.role, subject: t.subject });
          return t.access_token;
        } catch {
          set({ accessToken: null, refreshToken: null, role: null, subject: null });
          return null;
        }
      },
      logout: () => set({ accessToken: null, refreshToken: null, role: null, subject: null }),
    }),
    { name: 'speakedge-auth' },
  ),
);
