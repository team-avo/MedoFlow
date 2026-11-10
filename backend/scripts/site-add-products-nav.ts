/**
 * WS3 one-off: give existing clinic sites the Products menu link, the
 * homepage quick-links menu and the Products + Medicine store homepage
 * sections (src/site/services/productsNavUpgrade.ts). New sites get these
 * from the templates already.
 *
 * Writes DRAFTS only; each clinic reviews and publishes. Idempotent: a second
 * run reports "no change" for every site. Dry run unless --apply.
 *
 *   DATABASE_URL=<owner url> npx ts-node --transpile-only scripts/site-add-products-nav.ts [--apply] [--clinic <clinicId>]
 */
import { Prisma, PrismaClient } from '@prisma/client'
import { upgradeSiteForProducts } from '../src/site/services/productsNavUpgrade'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const clinicArg = args.includes('--clinic') ? args[args.indexOf('--clinic') + 1] : undefined

const db = new PrismaClient()

async function main() {
  const sites = await db.site.findMany({
    where: clinicArg ? { clinicId: clinicArg } : {},
    select: { id: true, clinicId: true, settingsDraftJson: true },
  })
  let changed = 0
  for (const site of sites) {
    const home = await db.sitePage.findFirst({
      where: { clinicId: site.clinicId, kind: 'HOME' },
      select: { id: true, draftSectionsJson: true },
    })
    let result
    try {
      result = upgradeSiteForProducts(site.settingsDraftJson, home?.draftSectionsJson ?? null)
    } catch (err) {
      process.stdout.write(`${site.clinicId}: SKIPPED (${(err as Error).message})\n`)
      continue
    }
    if (result.changes.length === 0) {
      process.stdout.write(`${site.clinicId}: no change\n`)
      continue
    }
    changed += 1
    process.stdout.write(
      `${site.clinicId}: ${result.changes.join('; ')}${apply ? '' : ' (dry run)'}\n`
    )
    if (!apply) continue
    await db.$transaction(async (tx) => {
      await tx.site.update({
        where: { id: site.id },
        data: { settingsDraftJson: result.settings as unknown as Prisma.InputJsonValue },
      })
      if (home && result.homeSections) {
        await tx.sitePage.update({
          where: { id: home.id },
          data: { draftSectionsJson: result.homeSections as unknown as Prisma.InputJsonValue },
        })
      }
    })
  }
  process.stdout.write(
    `${sites.length} site(s) checked, ${changed} ${apply ? 'updated (drafts — publish to go live)' : 'would change (run with --apply)'}\n`
  )
}

main()
  .catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
