import { isAmazonDistribution } from '@/services/distribution';
import Stripe from 'stripe';
import { getAPIBaseUrl, isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getAccessToken } from '@/utils/access';
import { StripeProductMetadata } from '@/types/payment';
import { AvailablePlan } from '@/types/quota';

// Checkout was removed: the reader apps sell nothing. What remains is the billing portal for
// accounts that already hold a plan, and the success page used by the legacy webhook flow.
const WEB_STRIPE_PORTAL_URL = `${getAPIBaseUrl()}/stripe/portal`;
const SUBSCRIPTION_SUCCESS_PATH = '/user/subscription/success';

export type StripeAvailablePlan = AvailablePlan & {
  metadata?: StripeProductMetadata;
  product?: Stripe.Product;
};

export const createStripePortalSession = async () => {
  if (isAmazonDistribution()) throw new Error('Purchases are disabled in the Amazon edition.');
  const token = await getAccessToken();

  const response = await fetch(WEB_STRIPE_PORTAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.url;
};

export const redirectToStripePortal = async (url: string): Promise<void> => {
  if (isAmazonDistribution()) return;
  if (isWebAppPlatform()) {
    window.location.href = url;
  } else if (isTauriAppPlatform()) {
    await openUrl(url);
  }
};

export const getSubscriptionSuccessUrl = (sessionId: string) => {
  const params = new URLSearchParams({
    payment: 'stripe',
    session_id: sessionId,
  });
  return `${SUBSCRIPTION_SUCCESS_PATH}?${params.toString()}`;
};
