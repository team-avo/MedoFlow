#!/usr/bin/env node
/**
 * CTO-11: fail CI if source code contains an em dash (U+2014, or its HTML
 * entities mdash and #8212). Product copy uses commas, colons, full stops or a middle dot
 * instead, and comments follow the same rule so the check needs no tokenizer.
 *
 *   node scripts/check-no-em-dash.js            scan every default area
 *   node scripts/check-no-em-dash.js backend    scan one area (backend | frontend | shared)
 *   node scripts/check-no-em-dash.js <path…>     scan these paths (relative to the repo root)
 *
 * Allowed: applied Prisma migrations (their checksums are recorded, so they
 * must never change), Markdown docs, build output and this file. To write the
 * character in code (a parser, say), use the `\u2014` escape.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const AREAS = {
  backend: ['backend/src', 'backend/prisma', 'backend/scripts', 'backend/edge'],
  frontend: [
    'frontend/app',
    'frontend/components',
    'frontend/contexts',
    'frontend/hooks',
    'frontend/lib',
    'frontend/e2e',
    'frontend/tests',
    'frontend/cf-front-door',
    'frontend/middleware.ts',
    'frontend/next.config.js',
    'frontend/tailwind.config.ts',
    'frontend/playwright.config.ts',
  ],
  shared: ['shared'],
}
const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.css',
])
const SKIP_DIRS = new Set(['node_modules', 'migrations', '.next', 'coverage', 'dist', '.open-next'])
const EM_DASH = /\u2014|&(?:mdash|#8212|#x2014);/i

const walk = (p) => {
  const full = path.resolve(ROOT, p)
  if (!fs.existsSync(full)) return []
  if (fs.statSync(full).isFile()) return [full]
  return fs
    .readdirSync(full, { withFileTypes: true })
    .flatMap((e) => (SKIP_DIRS.has(e.name) ? [] : walk(path.join(full, e.name))))
}

/** The files to scan for the given CLI arguments. Exported for the test. */
function targetsFor(args) {
  const paths = args.length ? args.flatMap((a) => AREAS[a] ?? [a]) : Object.values(AREAS).flat()
  return paths.flatMap(walk).filter((f) => EXTENSIONS.has(path.extname(f)) && f !== __filename)
}

/** Every `file:line: text` with an em dash. */
function findEmDashes(files) {
  const findings = []
  for (const file of files) {
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (EM_DASH.test(line))
          findings.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`)
      })
  }
  return findings
}

module.exports = { findEmDashes, targetsFor, EM_DASH }

if (require.main === module) {
  const files = targetsFor(process.argv.slice(2))
  const findings = findEmDashes(files)
  if (findings.length) {
    console.error(`Em dashes found (CTO-11). Use a comma, colon, full stop or "·" instead:\n`)
    for (const f of findings) console.error(`  ${f}`)
    console.error(
      `\n${findings.length} line(s). In code that must match the character, use \\u2014.`
    )
    process.exit(1)
  }
  console.log(`No em dashes in ${files.length} files.`)
}
