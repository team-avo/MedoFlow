import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * Integration suites (B0.1.5, B0.5.3): run against a real Postgres built
 * from migrations, with the app connected as the non-owner `medoflow_app`
 * role so the tenant guard AND row-level security are both live.
 *
 *   INTEGRATION_DATABASE_URL        app role  (postgresql://medoflow_app:…/db)
 *   INTEGRATION_ADMIN_DATABASE_URL  owner     (fixtures, raw checks)
 *
 *   pnpm run test:integration
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/integration/**/*.test.ts'],
    setupFiles: ['src/tests/integration/setup.ts'],
    // Files share one database; run them one at a time. Each file still gets
    // its own module graph (fresh in-memory rate limiters, monitors).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
