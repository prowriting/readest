import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = process.cwd();
const repo = join(app, '..', '..');
const read = (p: string) => readFileSync(p, 'utf8');

// Guards against upstream Readest branding and dead upsell surfaces leaking into the
// store builds. Each case names a surface an App Store reviewer sees.
describe('store builds carry BookArc branding only', () => {
  it('declares document types under the BookArc UTI namespace', () => {
    expect(read(join(app, 'src-tauri/Info.plist'))).not.toMatch(/com\.readest\./);
  });

  it('does not point the About dialog at the upstream Readest repository', () => {
    const about = read(join(app, 'src/components/AboutWindow.tsx'));
    expect(about).not.toMatch(/github\.com\/prowriting\/readest/);
    expect(about).not.toMatch(/agpl/i);
  });

  it('does not list a Readest email-in integration or its plan upsell', () => {
    const panel = read(join(app, 'src/components/settings/IntegrationsPanel.tsx'));
    expect(panel).not.toMatch(/Send to Readest/);
    expect(
      existsSync(join(app, 'src/components/settings/integrations/SendToReadestForm.tsx')),
    ).toBe(false);
  });

  it('does not ship the Stripe checkout or plan comparison surfaces', () => {
    expect(existsSync(join(app, 'src/app/user/components/Checkout.tsx'))).toBe(false);
    expect(existsSync(join(app, 'src/app/user/components/PlansComparison.tsx'))).toBe(false);
    expect(existsSync(join(app, 'src/app/api/stripe/checkout/route.ts'))).toBe(false);
    expect(existsSync(join(app, 'src/hooks/useAvailablePlans.ts'))).toBe(false);
  });

  it('does not bundle StoreKit purchasing in the iOS native bridge', () => {
    const ios = join(app, 'src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources');
    expect(existsSync(join(ios, 'StoreKitManager.swift'))).toBe(false);
    // StoreKit itself stays for Storefront.current (region code); only purchasing must be gone.
    expect(read(join(ios, 'NativeBridgePlugin.swift'))).not.toMatch(/SKPayment|SKProduct|iap_/);
  });

  it('uses the same privacy policy URL in the app and the App Store listing', () => {
    const legal = read(join(app, 'src/components/LegalLinks.tsx'));
    const inApp = legal.match(/href='([^']+)'[^>]*>\s*\{_\('Privacy Policy'\)\}/s)?.[1];
    const listing = read(join(repo, 'fastlane/metadata/ios/en-US/privacy_url.txt')).trim();
    expect(inApp).toBeTruthy();
    expect(listing).toBe(inApp);
  });
});
