/**
 * Stock a clinic that was signed up live in a demo with everything the rest of
 * the demo needs (prisma/demoStock.ts): Dr. Evelyn Chen with hours, a front
 * desk, the patient Anika Patel, the demo catalogue incl. the AI-scribe
 * products, packages, memberships, a commission rule and Visits A and B with
 * AI-scribe consent.
 *
 * The clinic must be approved. Dry run unless --apply. Idempotent.
 * Prints a one-time /set-password link per account (24 h); open each one in
 * that person's browser window. Links are printed here only, never stored.
 *
 *   DATABASE_URL=<owner url> npx ts-node --transpile-only scripts/demo-stock-clinic.ts \
 *     --label <web-address label> [--apply] [--frontend-url https://medoflow.pages.dev] \
 *     [--reissue] [--new-visits]
 */
import { PrismaClient } from '@prisma/client'
import { DemoStockError, stockDemoClinic } from '../prisma/demoStock'

const args = process.argv.slice(2)
const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)

const label = value('--label')
const apply = args.includes('--apply')
const frontendUrl =
  value('--frontend-url') ?? process.env.FRONTEND_URL ?? 'https://medoflow.pages.dev'

const out = (s = '') => process.stdout.write(`${s}\n`)
const db = new PrismaClient()

async function main() {
  if (!label) {
    out(
      'Usage: demo-stock-clinic.ts --label <web-address label> [--apply] [--frontend-url <url>] [--reissue] [--new-visits]'
    )
    process.exitCode = 2
    return
  }
  const report = await stockDemoClinic(db, {
    label,
    apply,
    frontendUrl,
    reissue: args.includes('--reissue'),
    newVisits: args.includes('--new-visits'),
  })
  out(report.applied ? '── Demo clinic stocked ──' : '── Dry run (nothing written; add --apply) ──')
  for (const line of report.lines) out(line)
  out()
  out('Accounts:')
  for (const a of report.accounts) {
    out(`  ${a.role.padEnd(10)} ${a.name.padEnd(16)} ${a.email}  [${a.status}]`)
    if (a.setupLink) out(`             set password: ${a.setupLink}`)
    else if (report.applied) out('             password already set (use --reissue for a new link)')
  }
  out()
  out('Visits with Dr. Chen (AI-scribe consent given):')
  for (const v of report.visits) {
    out(
      `  Visit ${v.key}: ${v.startsAt || '(would be booked at the next free slot)'}  [${v.status}]`
    )
  }
  if (report.applied) {
    out()
    out("Links work once and expire in 24 hours. Open each in that person's window.")
  }
}

main()
  .catch((err) => {
    if (err instanceof DemoStockError) {
      process.stderr.write(`Refused: ${err.message}\n`)
      process.exitCode = 1
      return
    }
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
