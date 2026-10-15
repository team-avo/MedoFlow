#!/usr/bin/env node
/**
 * B0.5.5 — fail CI if any seed / fixture / test file contains data that looks
 * like real PII. Synthetic data rules (docs/PHI_GATE.md):
 *   - emails on reserved/test domains only (example.com/.test, medoflow.test, *.demo …)
 *   - phone numbers in the 555 range
 *   - no SSNs, no card numbers other than published Stripe test cards
 *
 *   node scripts/check-synthetic-fixtures.js [paths…]
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_PATHS = ['prisma', 'src/tests', 'scripts']
const EXTENSIONS = new Set(['.ts', '.js', '.json', '.sql', '.csv'])

const WEBMAIL =
  /\b[A-Za-z0-9._%+-]+@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|gmx|yandex|zoho|mail)\.[a-z.]{2,}\b/gi
const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g
const PHONE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g
const CARD = /\b(?:\d[ -]?){13,19}\b/g
const STRIPE_TEST_CARDS = new Set([
  '4242424242424242',
  '4000056655665556',
  '5555555555554444',
  '2223003122003222',
  '5200828282828210',
  '5105105105105100',
  '378282246310005',
  '371449635398431',
  '6011111111111117',
  '6011000990139424',
  '3056930009020004',
  '36227206271667',
  '3566002020360505',
  '6200000000000005',
  '4000000000000002',
  '4000000000009995',
  '4000000000000069',
  '4000000000000127',
  '4000000000000119',
  '4000002500003155',
  '4000002760003184',
  '4000000000003220',
  '4000000000000341',
])

const luhn = (digits) => {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

const walk = (p) => {
  const full = path.resolve(ROOT, p)
  if (!fs.existsSync(full)) return []
  if (fs.statSync(full).isFile()) return [full]
  return fs
    .readdirSync(full, { withFileTypes: true })
    .flatMap((e) =>
      e.name === 'node_modules' || e.name === 'migrations' ? [] : walk(path.join(full, e.name))
    )
}

const findings = []
const targets = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PATHS).flatMap(walk)
for (const file of targets) {
  if (!EXTENSIONS.has(path.extname(file))) continue
  if (file === __filename) continue
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const where = `${path.relative(ROOT, file)}:${i + 1}`
    for (const m of line.matchAll(WEBMAIL)) findings.push(`${where} webmail address ${m[0]}`)
    for (const m of line.matchAll(SSN)) findings.push(`${where} SSN-like ${m[0]}`)
    for (const m of line.matchAll(PHONE)) {
      // 555-01xx is reserved for fiction; any 555 exchange is accepted as synthetic.
      if (m[2] !== '555' && m[1] !== '555') findings.push(`${where} non-555 phone ${m[0].trim()}`)
    }
    for (const m of line.matchAll(CARD)) {
      const digits = m[0].replace(/\D/g, '')
      if (
        digits.length >= 13 &&
        luhn(digits) &&
        !STRIPE_TEST_CARDS.has(digits) &&
        !/^(\d)\1+$/.test(digits)
      ) {
        findings.push(`${where} card-like number ${m[0].trim()}`)
      }
    }
  })
}

if (findings.length) {
  console.error(
    `✗ ${findings.length} real-looking PII value(s) in fixtures/seeds:\n  ${findings.join('\n  ')}`
  )
  console.error(
    'Use synthetic values: …@example.com / …@example.test, 555-01xx phones, Stripe test cards.'
  )
  process.exit(1)
}
console.log(`✓ synthetic-fixture check passed (${targets.length} files scanned)`)
