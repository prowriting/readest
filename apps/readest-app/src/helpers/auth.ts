import { getAPIBaseUrl } from '@/services/environment';
import type { AuthUser } from '@/context/AuthContext';

interface UseAuthCallbackOptions {
  accessToken?: string | null;
  refreshToken?: string | null;
  login: (accessToken: string, user: AuthUser) => void;
  navigate: (path: string) => void;
  type?: string | null;
  next?: string;
  error?: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
}

export function handleAuthCallback({
  accessToken,
  refreshToken,
  login,
  navigate,
  type,
  next = '/',
  error,
}: UseAuthCallbackOptions) {
  async function finalizeSession() {
    if (error) {
      navigate('/auth/error');
      return;
    }
    if (!accessToken || !refreshToken) {
      navigate('/library');
      return;
    }

    try {
      const resp = await fetch(`${getAPIBaseUrl()}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) {
        navigate('/auth/error');
        return;
      }

      const user = (await resp.json()) as AuthUser;
      localStorage.setItem('refresh_token', refreshToken);
      login(accessToken, user);

      if (type === 'recovery') {
        navigate('/auth/recovery');
        return;
      }
      navigate(next);
    } catch {
      navigate('/auth/error');
    }
  }

  finalizeSession();
}
