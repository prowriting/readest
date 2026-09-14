import { jwtDecode } from 'jwt-decode';
import { getAPIBaseUrl } from '@/services/environment';

export const AUTH_SESSION_CHANGED = 'bookarc-auth-session-changed';
const REFRESH_MARGIN_SECONDS = 60;
const REFRESH_TIMEOUT_MS = 15000;

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; [key: string]: unknown };
}

let inFlight: {
  token: string | null;
  refreshToken: string;
  promise: Promise<string | null>;
} | null = null;

const notifySessionChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_SESSION_CHANGED));
};

export const clearAuthSession = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  notifySessionChanged();
};

const needsRefresh = (token: string): boolean => {
  try {
    const { exp } = jwtDecode<{ exp?: number }>(token);
    return typeof exp === 'number' && exp <= Date.now() / 1000 + REFRESH_MARGIN_SECONDS;
  } catch {
    // Preserve the existing handling of opaque/legacy tokens. The API verifies them.
    return false;
  }
};

const isRefreshResponse = (value: unknown): value is RefreshResponse => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<RefreshResponse>;
  return (
    typeof data.accessToken === 'string' &&
    data.accessToken.length > 0 &&
    typeof data.refreshToken === 'string' &&
    data.refreshToken.length > 0 &&
    typeof data.user?.id === 'string' &&
    typeof data.user.email === 'string'
  );
};

/** All callers share the same refresh: server refresh tokens rotate after use. */
export const refreshAuthSession = (): Promise<string | null> => {
  if (typeof localStorage === 'undefined') return Promise.resolve(null);
  const token = localStorage.getItem('token');
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) {
    if (token && needsRefresh(token)) clearAuthSession();
    return Promise.resolve(null);
  }
  if (inFlight?.token === token && inFlight.refreshToken === refreshToken) return inFlight.promise;

  const unchanged = () =>
    localStorage.getItem('token') === token &&
    localStorage.getItem('refresh_token') === refreshToken;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  const promise = (async () => {
    try {
      const response = await fetch(`${getAPIBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      });
      if (!unchanged()) throw new Error('Session changed during token refresh');
      if (response.status === 401 || response.status === 403) {
        clearAuthSession();
        return null;
      }
      if (!response.ok) throw new Error('Unable to refresh session. Please try again.');
      const data: unknown = await response.json();
      if (!unchanged()) throw new Error('Session changed during token refresh');
      if (!isRefreshResponse(data)) throw new Error('Invalid session refresh response');
      localStorage.setItem('token', data.accessToken);
      localStorage.setItem('refresh_token', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      notifySessionChanged();
      return data.accessToken;
    } finally {
      clearTimeout(timeout);
      if (inFlight?.token === token && inFlight.refreshToken === refreshToken) inFlight = null;
    }
  })();
  inFlight = { token, refreshToken, promise };
  return promise;
};

export const getSessionAccessToken = async (): Promise<string | null> => {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem('token');
  if (!token || !needsRefresh(token)) return token;
  return refreshAuthSession();
};
