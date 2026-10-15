#!/usr/bin/env node
/**
 * Serves the production build for the Playwright e2e suite in ONE process,
 * so the test runner can stop it cleanly on every OS (`next start` forks a
 * child server that survives its parent on Windows).
 *
 *   node scripts/e2e-server.js 4310
 */
const http = require('http')
const next = require('next')

const port = Number(process.argv[2] || 4310)
const app = next({ dev: false, dir: require('path').resolve(__dirname, '..') })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = http.createServer((req, res) => handle(req, res))
  server.listen(port, '127.0.0.1', () => {
    console.log(`e2e server ready on http://127.0.0.1:${port}`)
  })
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
})
