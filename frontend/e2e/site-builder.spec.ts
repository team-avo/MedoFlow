/**
 * F8.1–F8.6 — the website builder end to end in the browser (API mocked by
 * e2e/siteMock.ts, which uses the real template catalog):
 *  - template gallery → preview → install → editor
 *  - edit → autosave → draft is NOT public → publish → public on both
 *    /s/<slug> and the clinic's own host (everwell.localhost)
 *  - keyboard reorder + undo, draft preview link, SEO tags, sitemap
 *  - custom domain: DNS records → verify; contact form → enquiries inbox
 */
import { expect, test, type Page } from '@playwright/test'
import type { Server } from 'node:http'
import { installMockApi } from './mockApi'
import { installSiteMock, newSiteState, startSiteSsrServer, type SiteState } from './siteMock'

let state: SiteState = newSiteState()
let ssr: Server

test.beforeAll(async () => {
  ssr = await startSiteSsrServer(() => state)
})
test.afterAll(() => new Promise<void>((r) => ssr.close(() => r())))
test.beforeEach(() => {
  state = newSiteState()
})

/** Clinic sites answer with real HTTP status codes (no streaming boundary above them). */
const BOT = {
  'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
}
const crawl = (page: Page, url: string) => page.request.get(url, { headers: BOT, maxRedirects: 0 })

async function asAdmin(page: Page) {
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true })
  await installSiteMock(page, state)
}

async function installClarity(page: Page) {
  await page.goto('/dashboard/site')
  await page.getByRole('button', { name: 'Browse templates' }).click()
  await expect(page).toHaveURL(/\/dashboard\/site\/templates$/)
  const card = page.getByTestId('template-clarity')
  await card.getByRole('button', { name: 'Use this template' }).click()
  await page.getByRole('button', { name: 'Install template' }).click()
  await expect(page).toHaveURL(/\/dashboard\/site\/editor\?page=/)
  await expect(
    page
      .getByRole('main', { name: 'Page preview' })
      .getByRole('heading', { name: 'Healthcare that starts with listening' })
  ).toBeVisible()
}

test('gallery: five templates, full-screen preview with page tabs and device widths', async ({
  page,
}) => {
  await asAdmin(page)
  await page.goto('/dashboard/site/templates')
  for (const key of ['clarity', 'serenity', 'vitality', 'heritage', 'botanica'])
    await expect(page.getByTestId(`template-${key}`)).toBeVisible()
  await page
    .getByTestId('template-serenity')
    .getByRole('button', { name: 'Preview', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Feel restored, inside and out' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Memberships' }).click()
  await expect(dialog.getByRole('heading', { name: 'Memberships & packages' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Phone' }).click()
  await expect(dialog.getByRole('button', { name: 'Phone' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

test('install → edit → autosave: the draft stays private until publish, then goes live', async ({
  page,
}) => {
  await asAdmin(page)
  await installClarity(page)

  // Nothing is public yet.
  expect((await crawl(page, '/s/everwell')).status()).toBe(404)

  // Edit the hero headline in the inspector.
  await page.getByTestId('section-row-hero').getByRole('button').nth(1).click()
  const headline = page.getByTestId('section-inspector').getByRole('textbox', { name: /^Headline/ })
  await headline.fill('Synthetic draft headline')
  await expect(
    page
      .getByRole('main', { name: 'Page preview' })
      .getByRole('heading', { name: 'Synthetic draft headline' })
  ).toBeVisible()
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 10_000 })
  expect(state.pages.find((p) => p.kind === 'HOME')!.draft[0]!.settings.headline).toBe(
    'Synthetic draft headline'
  )
  expect((await crawl(page, '/s/everwell')).status()).toBe(404)

  await page.getByTestId('publish-page').click()
  await expect(page.getByText('Published — your changes are live')).toBeVisible()

  // Live on the path fallback and on the clinic's own host.
  expect((await crawl(page, '/s/everwell')).status()).toBe(200)
  await page.goto('/s/everwell')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Synthetic draft headline' })
  ).toBeVisible()
  // Non-canonical URLs 308 to the canonical form.
  const slash = await crawl(page, '/s/everwell/about/')
  expect(slash.status()).toBe(308)
  expect(slash.headers()['location']).toBe('/s/everwell/about')
  await page.goto('http://everwell.localhost:4310/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Synthetic draft headline' })
  ).toBeVisible()
  expect(state.ssrCalls.some((c) => c.includes('host=everwell.localhost'))).toBe(true)

  // A further draft edit is not public until republished.
  const home = state.pages.find((p) => p.kind === 'HOME')!
  home.draft[0]!.settings.headline = 'Second draft — private'
  await page.reload()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Synthetic draft headline' })
  ).toBeVisible()
  await expect(page.getByText('Second draft — private')).toHaveCount(0)
})

test('keyboard reorder, undo, and the draft preview link', async ({ page, context }) => {
  await asAdmin(page)
  await installClarity(page)
  const rows = page.getByRole('list', { name: 'Page sections' }).getByRole('listitem')
  await expect(rows.first()).toHaveAttribute('data-testid', 'section-row-hero')

  // Keyboard drag (accessible reorder): Space picks up, ArrowDown moves, Space drops.
  const heroId = await page.locator('[data-section-id]').first().getAttribute('data-section-id')
  const handle = page.getByRole('button', { name: /^Reorder Hero/ })
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowDown')
  // The screen-reader announcement names the new position before we drop.
  await expect(
    page.getByText(new RegExp(`moved over droppable area (?!${heroId})s_`))
  ).toBeAttached()
  await page.keyboard.press('Space')
  await expect(rows.first()).toHaveAttribute('data-testid', 'section-row-trust-bar')
  await expect(rows.nth(1)).toHaveAttribute('data-testid', 'section-row-hero')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(rows.first()).toHaveAttribute('data-testid', 'section-row-hero')
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(rows.first()).toHaveAttribute('data-testid', 'section-row-trust-bar')

  // Preview opens the signed draft link on the clinic host.
  const popupPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Preview' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  expect(popup.url()).toMatch(/^http:\/\/everwell\.localhost:4310\/preview\/[a-z0-9]+\?token=/)
  await expect(popup.getByRole('status').filter({ hasText: 'Draft preview' })).toBeVisible()
  await expect(popup.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('SEO: title, canonical, JSON-LD and the sitemap on the clinic host', async ({ page }) => {
  await asAdmin(page)
  await installClarity(page)
  await page.getByTestId('publish-page').click()
  await expect(page.getByText('Published — your changes are live')).toBeVisible()
  await page.goto('/dashboard/site')
  await page.getByTestId('publish-site').click()
  await expect(page.getByText('Your website is live')).toBeVisible()

  await page.goto('http://everwell.localhost:4310/about')
  await expect(page).toHaveTitle(/About us \| Everwell Synthetic Clinic/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'http://everwell.localhost:4310/about'
  )
  const ld = await page.locator('script[type="application/ld+json"]').first().textContent()
  expect(JSON.parse(ld!)['@type']).toBe('MedicalClinic')

  const sitemap = await page.request.get('http://everwell.localhost:4310/sitemap.xml')
  expect(sitemap.headers()['content-type']).toContain('application/xml')
  expect(await sitemap.text()).toContain('<loc>http://everwell.localhost:4310/about</loc>')
  const robots = await page.request.get('http://everwell.localhost:4310/robots.txt')
  expect(await robots.text()).toContain('Sitemap: http://everwell.localhost:4310/sitemap.xml')
  // Staff URLs on a clinic host never show the dashboard there.
  const internal = await page.request.get('/clinic-site/everwell.localhost', { maxRedirects: 0 })
  expect(internal.status()).toBe(404)
})

test('custom domain: DNS records, a failed check, then verified', async ({ page }) => {
  await asAdmin(page)
  await page.goto('/dashboard/site/domains')
  await expect(page.getByTestId('subdomain-url')).toHaveText('everwell.localhost')
  await page.getByLabel('Domain', { exact: true }).fill('www.everwell.example')
  await page.getByRole('button', { name: 'Add domain' }).click()
  const row = page.getByTestId('domain-www.everwell.example')
  await expect(row.getByText('_medoflow-verify.www.everwell.example')).toBeVisible()
  await expect(row.getByText('sites.localhost')).toBeVisible()
  await row.getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(row.getByText(/TXT record not found yet/)).toBeVisible()
  state.domains.find((d) => d.hostname === 'www.everwell.example')!.dnsReady = true
  await row.getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(row.getByText('Connected')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Make primary' })).toBeVisible()
})

test('contact form on the live site → the enquiries inbox', async ({ page }) => {
  await asAdmin(page)
  await installClarity(page)
  await page.goto('/dashboard/site')
  await page.getByTestId('publish-site').click()
  await expect(page.getByText('Your website is live')).toBeVisible()

  await page.goto('http://everwell.localhost:4310/contact')
  await page.getByLabel('Name').fill('Quinn Marlowe')
  await page.getByLabel('Email').fill('quinn.marlowe@example.test')
  await page.getByLabel('Message').fill('Synthetic enquiry about appointments.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(
    page.getByText('Thank you — a member of our team will reply within one business day.')
  ).toBeVisible()
  expect(state.leads[0]!.body).toMatchObject({
    host: 'everwell.localhost:4310',
    website: '',
    sourcePath: '/contact',
  })

  await page.goto('/dashboard/site/leads')
  await page.getByTestId('lead-row').first().click()
  await expect(page.getByTestId('lead-message')).toHaveText('Synthetic enquiry about appointments.')
})
