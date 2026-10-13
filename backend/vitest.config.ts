import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    // Unit tests mock Prisma and call services without a request context, so
    // the tenant guard and RLS wrapper are off here. Both are exercised for
    // real by src/tests/tenantGuard.test.ts (explicit mode) and by the
    // integration suites (enforce + RLS against Postgres).
    env: { TENANT_ISOLATION_MODE: 'off', TENANT_RLS: 'off' },
    // DB-backed suites have their own config: vitest.integration.config.ts
    exclude: ['src/tests/integration/**', 'node_modules/**'],
    // Tests that hit Prisma/DB are skipped unless INTEGRATION=1 is set
    // Run integration suite: INTEGRATION=1 pnpm test
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/tests/**', 'src/server.ts', 'src/app.ts'],
      // B0.5.2 coverage ratchet: set just below the measured baseline
      // (2026-10-13: lines 17.8%, functions 42.6%, branches 57.7%). Raise
      // these whenever coverage goes up; a PR that lowers coverage fails CI.
      thresholds: {
        lines: 17,
        statements: 17,
        functions: 42,
        branches: 57,
      },
    },
  },
})
