import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Frontend unit + component tests (F0.4). Browser end-to-end flows live in
 * e2e/ and run with Playwright (`pnpm test:e2e`).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'lib/**/*.test.{js,ts}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**', '.open-next/**'],
    env: { NEXT_PUBLIC_API_URL: 'http://api.test' },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: [
        'lib/**',
        'contexts/**',
        'components/auth/**',
        'components/layout/DashboardLayout.tsx',
        // Component 3 (F3.1–F3.3)
        'components/PatientFilesSection.tsx',
        'components/records/**',
        'components/forms/DynamicFormRenderer.tsx',
        'hooks/**',
      ],
      exclude: ['**/*.test.*'],
      // Ratchet: set at the measured baseline of this suite; raise as tests grow (F0.4.1).
      thresholds: { lines: 19, functions: 50, branches: 75 },
    },
  },
})
