#!/usr/bin/env node
/**
 * B0.5.1 dependency gate for the backend: fails on any high/critical advisory
 * in a production dependency reachable from the backend package.
 *
 * `pnpm audit` is workspace-wide; frontend findings are tracked under F0.1 and
 * must not block backend merges, so findings are filtered to paths that start
 * at `backend>`. Accepted exceptions live in audit-exceptions.json with an
 * owner, a reason and an expiry date; an expired exception fails the gate.
 *
 *   node scripts/audit-backend.js        (from backend/ or the repo root)
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..', '..')
const exceptionsFile = path.join(__dirname, 'audit-exceptions.json')
const exceptions = fs.existsSync(exceptionsFile)
  ? JSON.parse(fs.readFileSync(exceptionsFile, 'utf8'))
  : []
const today = new Date().toISOString().slice(0, 10)

let raw
try {
  raw = execSync('pnpm audit --prod --json', {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (err) {
  // pnpm audit exits non-zero when anything is found; the JSON is still on stdout.
  raw = err.stdout
}
const report = JSON.parse(raw)

const failures = []
const accepted = []
for (const adv of Object.values(report.advisories ?? {})) {
  if (!['high', 'critical'].includes(adv.severity)) continue
  const backendPaths = (adv.findings ?? [])
    .flatMap((f) => f.paths)
    .filter((p) => p.startsWith('backend>'))
  if (backendPaths.length === 0) continue
  const ghsa = adv.github_advisory_id
  const exception = exceptions.find((e) => e.id === ghsa)
  const line = `${adv.severity.toUpperCase()} ${adv.module_name} ${adv.vulnerable_versions} (${ghsa}) via ${backendPaths[0]}`
  if (exception && exception.expires >= today)
    accepted.push(`${line} — accepted until ${exception.expires}: ${exception.reason}`)
  else failures.push(exception ? `${line} — exception EXPIRED ${exception.expires}` : line)
}

for (const a of accepted) console.warn(`! ${a}`)
if (failures.length) {
  console.error(
    `✗ ${failures.length} high/critical backend production advisories:\n  ${failures.join('\n  ')}`
  )
  process.exit(1)
}
console.log(`✓ no unaccepted high/critical advisories in backend production dependencies`)
