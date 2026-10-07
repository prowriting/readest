import type { AuthUser } from '@/context/AuthContext';
import type { AppleIDAuthorizationResponse } from '@/app/auth/utils/appleIdAuth';

export interface AppleSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface AppleMarketingConsent {
  marketingOptIn: boolean;
  marketingPolicyVersion?: string;
  marketingWordingVersion?: string;
}

export type AppleExchangeResult =
  | { ok: true; session: AppleSession }
  | { ok: false; error: string; status?: number };

/**
 * Exchanges a native Sign in with Apple credential for a BookArc session.
 * Every failure is reported explicitly so the caller can show it; nothing is swallowed.
 */
export async function exchangeAppleCredential(
  apiBase: string,
  credential: AppleIDAuthorizationResponse,
  consent: AppleMarketingConsent,
): Promise<AppleExchangeResult> {
  if (!credential.identityToken) {
    return { ok: false, error: 'Apple did not return an identity token' };
  }

  const resp = await fetch(`${apiBase}/auth/apple/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
      marketingOptIn: consent.marketingOptIn,
      marketingPolicyVersion: consent.marketingPolicyVersion,
      marketingWordingVersion: consent.marketingWordingVersion,
    }),
  });

  if (!resp.ok) {
    let error = `Apple sign-in failed (HTTP ${resp.status})`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body?.error) error = body.error;
    } catch {
      // Non-JSON error body: keep the status-based message.
    }
    return { ok: false, error, status: resp.status };
  }

  const session = (await resp.json()) as AppleSession;
  return { ok: true, session };
}
