/**
 * Component 8 — LIVE front-end ↔ back-end check of the website builder (no
 * mocks): real API, real Postgres with RLS + field encryption, real host
 * routing through <clinic-slug>.localhost (Chromium resolves *.localhost to
 * loopback). Opt-in: runs only when E2E_LIVE_API is set. See the Component 8
 * walkthrough §4.6.
 *
 * Backend:  SITE_ROOT_DOMAIN=localhost SITE_PUBLIC_PORT=4310 CORS_ORIGIN=http://127.0.0.1:4310
 * Frontend: built with NEXT_PUBLIC_API_URL=<E2E_LIVE_API> NEXT_PUBLIC_SITE_ROOT_DOMAIN=localhost
 *
 *   E2E_LIVE_API=http://127.0.0.1:4302 E2E_LIVE_SEED='<seed json>' \
 *   E2E_LIVE_PASSWORD=<seed password> E2E_EXTERNAL_SERVER=1 \
 *   pnpm exec playwright test e2e/live-site.spec.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { PNG_BYTES } from './filesMock'

const LIVE = process.env.E2E_LIVE_API
const seed = LIVE
  ? (JSON.parse(process.env.E2E_LIVE_SEED ?? '{}') as {
      clinicId: string
      clinicSlug: string
      serviceId: string
      emails: { admin: string }
    })
  : null
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? ''
const PORT = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4310').port
const host = () => `http://${seed!.clinicSlug}.localhost:${PORT}`

test.describe.configure({ mode: 'serial' })
test.skip(!LIVE, 'live check: set E2E_LIVE_API (see the Component 8 walkthrough)')

async function signIn(page: Page, returnUrl: string) {
  await page.goto(`/?auth=login&returnUrl=${encodeURIComponent(returnUrl)}`)
  await page.getByLabel(/email/i).first().fill(seed!.emails.admin)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(returnUrl.replace(/[/?]/g, '\\$&')))
}

test('template → edit → publish: the clinic subdomain serves the branded site (SSR, SEO)', async ({
  page,
}) => {
  await signIn(page, '/dashboard/site')
  // Nothing published yet: the clinic host is a real 404.
  expect((await page.request.get(`${host()}/`)).status()).toBe(404)

  await page.getByRole('button', { name: 'Browse templates' }).click()
  await page
    .getByTestId('template-heritage')
    .getByRole('button', { name: 'Use this template' })
    .click()
  await page.getByRole('button', { name: 'Install template' }).click()
  await expect(page).toHaveURL(/\/dashboard\/site\/editor\?page=/)

  await page.getByTestId('section-row-hero').getByRole('button').nth(1).click()
  await page
    .getByTestId('section-inspector')
    .getByRole('textbox', { name: /^Headline/ })
    .fill('Live synthetic family care')
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 15_000 })
  await page.goto('/dashboard/site')
  await page.getByTestId('publish-site').click()
  await expect(page.getByText('Your website is live')).toBeVisible()

  await page.goto(`${host()}/`)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Live synthetic family care' })
  ).toBeVisible()
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${host()}/`)
  const ld = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').first().textContent())!
  )
  expect(ld).toMatchObject({ '@type': 'MedicalClinic' })
  // Live clinic data: the seeded service books straight into the app's booking flow.
  await expect(page.getByRole('link', { name: 'Consult' }).first()).toBeVisible()

  // The app-host path fallback 308s to the canonical subdomain.
  const fallback = await page.request.get(`/s/${seed!.clinicSlug}/team`, { maxRedirects: 0 })
  expect(fallback.status()).toBe(308)
  expect(fallback.headers()['location']).toBe(`${host()}/team`)

  const sitemap = await page.request.get(`${host()}/sitemap.xml`)
  expect(await sitemap.text()).toContain(`<loc>${host()}/new-patients</loc>`)
})

test('a draft edit stays private until it is published again', async ({ page }) => {
  await signIn(page, '/dashboard/site/editor')
  await page.getByTestId('section-row-hero').getByRole('button').nth(1).click()
  await page
    .getByTestId('section-inspector')
    .getByRole('textbox', { name: /^Headline/ })
    .fill('Private live draft headline')
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 15_000 })

  const live = await page.request.get(
    `${LIVE}/api/v1/public/sites/render?host=${seed!.clinicSlug}.localhost&path=/`
  )
  const body = await live.text()
  expect(body).toContain('Live synthetic family care')
  expect(body).not.toContain('Private live draft headline')

  await page.getByTestId('publish-page').click()
  await expect(page.getByText('Published — your changes are live')).toBeVisible()
  await page.goto(`${host()}/`)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Private live draft headline' })
  ).toBeVisible()
})

test('contact form on the clinic host → sealed enquiry → audited read in the inbox', async ({
  page,
}) => {
  await page.goto(`${host()}/contact`)
  await page.getByLabel('Name').fill('Quinn Marlowe')
  await page.getByLabel('Email').fill('quinn.marlowe@example.test')
  await page.getByLabel('Message').fill('Live synthetic enquiry about a first visit.')
  // The time-trap needs a human-like pause before sending.
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(
    page.getByText('Thank you — a member of our team will reply within one business day.')
  ).toBeVisible()

  await signIn(page, '/dashboard/site/leads')
  await page.getByTestId('lead-row').first().click()
  await expect(page.getByTestId('lead-message')).toHaveText(
    'Live synthetic enquiry about a first visit.'
  )
})

test('images upload through a presigned URL; the free plan shows its subdomain and locks custom domains', async ({
  page,
}) => {
  await signIn(page, '/dashboard/site/media')
  await page
    .getByTestId('media-upload-input')
    .setInputFiles({ name: 'clinic-front.png', mimeType: 'image/png', buffer: PNG_BYTES })
  await expect(page.getByText('Image uploaded')).toBeVisible()
  await expect(page.getByRole('img', { name: /clinic front/i })).toBeVisible()

  await page.goto('/dashboard/site/domains')
  await expect(page.getByTestId('subdomain-url')).toHaveText(`${seed!.clinicSlug}.localhost`)
  await expect(page.getByTestId('domain-plan-lock')).toBeVisible()
})
