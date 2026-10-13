import { defineConfig, devices } from '@playwright/test'

/**
 * Browser end-to-end tests (F0.2.1 idle logoff, F0.2.2 MFA enrol + challenge).
 *
 * They drive the production build of the app in Chromium. The API is
 * simulated per test by e2e/mockApi.ts (stateful, verifies real RFC 6238
 * TOTP codes), so the suite needs no database and runs the same in CI.
 * The real backend behaviour behind these screens is covered by the backend
 * integration suites (authSafeguards.int.test.ts).
 *
 *   pnpm test:e2e                     build + start on :4310, run (CI, Linux/macOS)
 *   E2E_SKIP_BUILD=1 pnpm test:e2e    reuse the last e2e build
 *   Windows: Playwright cannot stop its server there, so run it yourself —
 *     terminal 1: NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 pnpm exec next build && pnpm test:e2e:serve
 *     terminal 2: E2E_EXTERNAL_SERVER=1 pnpm test:e2e
 */
const PORT = 4310
export const E2E_API_URL = 'http://127.0.0.1:3999'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // E2E_EXTERNAL_SERVER=1: a server is already running on PORT (started by hand).
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : {
        // One-process server (scripts/e2e-server.js), so Playwright can stop it on
        // every OS — `next start` forks a child that outlives it on Windows.
        command: process.env.E2E_SKIP_BUILD
          ? `node scripts/e2e-server.js ${PORT}`
          : `node node_modules/next/dist/bin/next build && node scripts/e2e-server.js ${PORT}`,
        url: `http://127.0.0.1:${PORT}`,
        timeout: 600_000,
        // Never reuse: a stale server would test an old build.
        reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
        env: { NEXT_PUBLIC_API_URL: E2E_API_URL, NEXT_TELEMETRY_DISABLED: '1' },
      },
})
