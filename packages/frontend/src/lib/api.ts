const API_BASE = '/api';

let accessToken: string | null = null;
let refreshToken: string | null = null;

const TOKEN_KEY = 'ws_access_token';
const REFRESH_KEY = 'ws_refresh_token';

function isStoredToken(value: string | null): value is string {
  return Boolean(value && value !== 'undefined' && value !== 'null');
}

export function loadTokens() {
  const storedAccess = localStorage.getItem(TOKEN_KEY);
  const storedRefresh = localStorage.getItem(REFRESH_KEY);

  if (isStoredToken(storedAccess) && isStoredToken(storedRefresh)) {
    accessToken = storedAccess;
    refreshToken = storedRefresh;
    return;
  }

  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string) {
  if (!isStoredToken(access) || !isStoredToken(refresh)) {
    throw new Error('Invalid authentication tokens received');
  }
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getAccessToken() {
  return accessToken;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      clearTokens();
      return false;
    }

    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
      throw new ApiError(0, 'Unable to connect to the server. Check your internet connection.');
    }
    throw err;
  }

  // If 401 and we have a refresh token, try refreshing
  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    }
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? (body as { message: string }).message
        : undefined) ?? res.statusText;
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Upload a file via multipart/form-data.
 * Does NOT set Content-Type — the browser sets it with the boundary.
 */
export async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
): Promise<T> {
  const headers: Record<string, string> = {};

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    });
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
      throw new ApiError(0, 'Unable to connect to the server. Check your internet connection.');
    }
    throw err;
  }

  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers,
        body: formData,
      });
    }
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? (body as { message: string }).message
        : undefined) ?? res.statusText;
    throw new ApiError(res.status, message, body);
  }

  return res.json();
}
