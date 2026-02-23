import {
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { AuthUser } from 'shared';
import { api, setTokens, clearTokens, loadTokens, getAccessToken } from '../lib/api';
import { AuthContext } from './AuthContext';

interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Request timed out'));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeout);
        reject(error);
      });
  });
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (!value || typeof value !== 'object') return false;

  const data = value as Partial<AuthResponse>;
  return Boolean(
    data.user &&
    typeof data.user === 'object' &&
    typeof data.accessToken === 'string' &&
    typeof data.refreshToken === 'string',
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => {
    loadTokens();
    const hasToken = !!getAccessToken();
    const shouldTryDevBootstrapWithoutToken =
      !hasToken && import.meta.env.DEV && import.meta.env.MODE !== 'test';
    return {
      user: null as AuthUser | null,
      loading: hasToken || shouldTryDevBootstrapWithoutToken,
    };
  });

  useEffect(() => {
    if (!state.loading) return;

    let cancelled = false;
    const hasToken = !!getAccessToken();
    const timeoutMs = hasToken ? 8000 : 2000;

    withTimeout(api<{ user: AuthUser }>('/auth/me'), timeoutMs)
      .then((data) => {
        if (cancelled) return;
        setState({ user: data.user, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        clearTokens();
        setState({ user: null, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [state.loading]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<unknown>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!isAuthResponse(data)) {
      clearTokens();
      throw new Error('Login failed: invalid session response');
    }
    setTokens(data.accessToken, data.refreshToken);
    setState({ user: data.user, loading: false });
  }, []);

  const register = useCallback(
    async (data: { email: string; password: string; firstName: string; lastName: string }) => {
      const res = await api<unknown>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (!isAuthResponse(res)) {
        clearTokens();
        throw new Error('Registration failed: invalid session response');
      }
      setTokens(res.accessToken, res.refreshToken);
      setState({ user: res.user, loading: false });
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // ignore errors during logout
    }
    clearTokens();
    setState({ user: null, loading: false });
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api<{ user: AuthUser }>('/auth/me');
      setState({ user: data.user, loading: false });
    } catch {
      clearTokens();
      setState({ user: null, loading: false });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
