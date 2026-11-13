/**
 * CTO-11 one-off: remove em dashes from website copy clinics already have
 * (src/site/services/emDashUpgrade.ts). Covers the draft AND the published
 * copy of every page (sections, titles, SEO fields) and the site settings,
 * so a live site changes without a re-publish. Published revision history is
 * left as it was.
 *
 * Idempotent: a second run reports "no change" for every site. Dry run unless
 * --apply.
 *
 *   DATABASE_URL=<owner url> npx ts-node --transpile-only scripts/site-remove-em-dash.ts [--apply] [--clinic <clinicId>]
 */
import { Prisma, PrismaClient } from '@prisma/client'
import {
  SITE_COPY_FIELDS,
  SITE_PAGE_COPY_FIELDS,
  upgradeRow,
} from '../src/site/services/emDashUpgrade'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const clinicArg = args.includes('--clinic') ? args[args.indexOf('--clinic') + 1] : undefined

const db = new PrismaClient()

const asJson = (data: Record<string, unknown>) =>
  data as unknown as Prisma.SitePageUpdateInput & Prisma.SiteUpdateInput

async function main() {
  const sites = await db.site.findMany({
    where: clinicArg ? { clinicId: clinicArg } : {},
    select: { id: true, clinicId: true, settingsDraftJson: true, settingsPublishedJson: true },
  })
  let sitesChanged = 0
  for (const site of sites) {
    const pages = await db.sitePage.findMany({
      where: { clinicId: site.clinicId },
      select: {
        id: true,
        slug: true,
        title: true,
        sectionsJson: true,
        draftSectionsJson: true,
        seoTitle: true,
        seoDescription: true,
        draftTitle: true,
        draftSeoTitle: true,
        draftSeoDescription: true,
      },
    })
    const settings = upgradeRow(site, SITE_COPY_FIELDS)
    const pageUpdates = pages
      .map((p) => ({ page: p, ...upgradeRow(p, SITE_PAGE_COPY_FIELDS) }))
      .filter((u) => u.changed > 0)
    const total = settings.changed + pageUpdates.reduce((n, u) => n + u.changed, 0)
    if (total === 0) {
      process.stdout.write(`${site.clinicId}: no change\n`)
      continue
    }
    sitesChanged += 1
    const where = [
      settings.changed ? `settings (${settings.changed})` : '',
      ...pageUpdates.map((u) => `/${u.page.slug} (${u.changed})`),
    ].filter(Boolean)
    process.stdout.write(
      `${site.clinicId}: ${total} string(s) in ${where.join(', ')}${apply ? '' : ' (dry run)'}\n`
    )
    if (!apply) continue
    await db.$transaction(async (tx) => {
      if (settings.changed)
        await tx.site.update({ where: { id: site.id }, data: asJson(settings.data) })
      for (const u of pageUpdates)
        await tx.sitePage.update({ where: { id: u.page.id }, data: asJson(u.data) })
    })
  }
  process.stdout.write(
    `${sites.length} site(s) checked, ${sitesChanged} ${apply ? 'updated' : 'would change (run with --apply)'}\n`
  )
}

main()
  .catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
