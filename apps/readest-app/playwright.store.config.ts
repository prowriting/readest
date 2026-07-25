import { defineConfig } from '@playwright/test';

/**
 * Play Store screenshot capture lane.
 *
 * Drives the web app at phone/tablet viewports and saves raw PNG captures to
 * `scripts/store-assets/captures/<project>/` for the compositor
 * (`scripts/store-assets/compose-store-shots.mjs`) to turn into listing
 * images. Run via `pnpm store:capture`; not part of `pnpm test:e2e:web`
 * (its specs live in `e2e/store/`, outside the main config's testDir).
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT) || 3000;

export default defineConfig({
  testDir: './e2e/store',
  fullyParallel: false,
  // Captures are cheap but must be deterministic; keep one worker so the
  // dev server never juggles two imports at once.
  workers: 1,
  retries: 1,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: {
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'tablet7',
      use: {
        viewport: { width: 800, height: 1280 },
        deviceScaleFactor: 2,
        hasTouch: true,
      },
    },
    {
      name: 'tablet10',
      use: {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: process.env.CI ? 'pnpm start-web' : 'pnpm dev-web',
    port: PORT,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
