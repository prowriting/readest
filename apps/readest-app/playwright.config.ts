import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright web e2e lane.
 *
 * This suite drives the Next.js *web* build (`pnpm dev-web`) in a real browser.
 * It is complementary to — not a replacement for — the WebdriverIO suite
 * (`e2e/app.e2e.ts`, run via `pnpm test:e2e`), which drives the Tauri shell.
 *
 *   - Specs:        e2e/tests/**\/*.spec.ts
 *   - Page objects: e2e/pages
 *   - Fixtures:     e2e/fixtures
 *
 * Tests run unauthenticated against a fresh browser context, so each test
 * starts from an isolated, empty local library.
 */
// Defaults to 3000; override with PLAYWRIGHT_PORT to run alongside another dev
// server already bound to 3000 (e.g. the BookArcWeb marketing site).
const PORT = Number(process.env.PLAYWRIGHT_PORT) || 3000;

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Tests are isolated (a fresh browser context per test), so they run in
  // parallel. `test:e2e:web:headed` overrides this to 1 to stay watchable.
  workers: 4,
  // Always write the HTML report so `pnpm test:e2e:web:report` can open it.
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // AAC needs licensed codecs that bundled Chromium lacks.
      testIgnore: /audiobook-aac\.spec\.ts/,
    },
    // Codec-coverage lane: branded Chrome decodes AAC/M4B. Included only
    // where Chrome is installed so `pnpm test:e2e:web` stays green anywhere.
    ...(existsSync('/Applications/Google Chrome.app') ||
    existsSync('/usr/bin/google-chrome') ||
    existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
      ? [
          {
            name: 'chrome-aac',
            use: { ...devices['Desktop Chrome'], channel: 'chrome' as const },
            testMatch: /audiobook-aac\.spec\.ts/,
          },
        ]
      : []),
  ],
  webServer: {
    // CI runs against a production build (`pnpm build-web` runs first as a
    // separate CI step) — `next dev` shows an error overlay on the app's
    // `next-view-transitions` unhandled rejection, which intercepts clicks.
    command: process.env.CI ? 'pnpm start-web' : 'pnpm dev-web',
    port: PORT,
    // Next.js reads PORT from the environment; passing it here keeps the dev
    // server and `baseURL` on the same (optionally overridden) port.
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
