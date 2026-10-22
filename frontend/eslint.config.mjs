// ESLint flat config (Next.js 16 removed `next lint`; run `pnpm run lint`).
// Same rules as the former .eslintrc.json: Next core-web-vitals, no-console
// (client logs go through lib/clientLog — F0.3.2), with the same exceptions.
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      'no-console': 'error',
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    // Rules that are new in eslint-config-next 16 (react-hooks v7 React
    // Compiler rules, and one new Next rule). They did not exist under
    // Next 15, and the upgrade keeps the existing lint bar: they flag ~56
    // existing call sites across ~45 files whose fixes change runtime
    // behaviour, so they are adopted in a separate follow-up, not here.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/incompatible-library': 'off',
      '@next/next/no-location-assign-relative-destination': 'off',
    },
  },
  {
    files: ['lib/clientLog.ts', 'scripts/**', 'e2e/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-console': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    '.open-next/**',
    '.wrangler/**',
    'node_modules/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
])
