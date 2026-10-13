import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    // DB-backed suites have their own config: vitest.integration.config.ts
    exclude: ['src/tests/integration/**', 'node_modules/**'],
    // Tests that hit Prisma/DB are skipped unless INTEGRATION=1 is set
    // Run integration suite: INTEGRATION=1 pnpm test
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/tests/**', 'src/server.ts', 'src/app.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
})
