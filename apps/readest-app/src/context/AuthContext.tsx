'use client';

import {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  useEffect,
  ReactNode,
} from 'react';
import { getAPIBaseUrl } from '@/services/environment';
import { AUTH_SESSION_CHANGED, clearAuthSession, refreshAuthSession } from '@/utils/authSession';

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string | null;
  plan: string;
  createdAt: string;
}

interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('token');
    return null;
  });
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('user');
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    }
    return null;
  });

  useEffect(() => {
    const updateSession = () => {
      setToken(localStorage.getItem('token'));
      const raw = localStorage.getItem('user');
      setUser(raw ? (JSON.parse(raw) as AuthUser) : null);
    };
    window.addEventListener(AUTH_SESSION_CHANGED, updateSession);
    window.addEventListener('storage', updateSession);
    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGED, updateSession);
      window.removeEventListener('storage', updateSession);
    };
  }, []);

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  }, []);

  const logout = useCallback(async () => {
    const storedRefresh = localStorage.getItem('refresh_token');
    const currentToken = localStorage.getItem('token');
    // Clear the local session first so logout always takes effect, even if the
    // server call hangs or is unreachable (e.g. a cold-starting API). Otherwise the
    // user gets navigated away while still signed in locally.
    clearAuthSession();
    setToken(null);
    setUser(null);
    // Best-effort server-side token revocation — must not block or reverse logout.
    try {
      await fetch(`${getAPIBaseUrl()}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
        },
        body: JSON.stringify({ refreshToken: storedRefresh ?? '' }),
      });
    } catch {
      /* best-effort */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await refreshAuthSession();
    } catch {
      /* silent */
    }
  }, []);

  const value = useMemo(
    () => ({ token, user, login, logout, refresh }),
    [token, user, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
