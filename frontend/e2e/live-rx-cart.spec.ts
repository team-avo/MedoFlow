/**
 * Component 5 — LIVE front-end ↔ back-end check of Prescription → Cart (no
 * mocks). Opt-in: runs only when E2E_LIVE_API is set, against a real backend
 * (Postgres with RLS + field encryption) and a frontend built with
 * NEXT_PUBLIC_API_URL pointing at it. Synthetic data from
 * backend/scripts/seed-e2e-live.ts. See the Component 5 walkthrough §4.6.
 *
 *   E2E_LIVE_API=http://127.0.0.1:4302 E2E_LIVE_SEED='<seed json>' \
 *   E2E_LIVE_PASSWORD=<password used for the seed> E2E_EXTERNAL_SERVER=1 \
 *   pnpm exec playwright test e2e/live-rx-cart.spec.ts
 *
 * Without Stripe test keys on the backend the patient has no card on file,
 * so the cart shows the regular checkout (the B5.4 fallback). With keys and
 * a card saved at booking, one-click is covered by the manual guide (§9).
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.E2E_LIVE_API
const seed = LIVE
  ? (JSON.parse(process.env.E2E_LIVE_SEED ?? '{}') as {
      rxVisitRecordId: string
      emails: { provider: string; patient: string }
    })
  : null
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? ''

test.describe.configure({ mode: 'serial' })
test.skip(!LIVE, 'live check: set E2E_LIVE_API (see the Component 5 walkthrough)')
test.use({ timezoneId: 'UTC', locale: 'en-US' })

async function signIn(page: Page, email: string, returnUrl: string) {
  await page.goto(`/?auth=login&returnUrl=${encodeURIComponent(returnUrl)}`)
  await page.getByLabel(/email/i).first().fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(returnUrl.replace(/[/]/g, '\\/')))
}

function watchUrls(page: Page) {
  const urls: string[] = []
  page.on('request', (r) => urls.push(r.url()))
  return urls
}
const expectNoPhiInUrls = (urls: string[]) => {
  const leaks = urls.filter((u) =>
    /quinn|marlowe|magnesium|arnica|tramadol|turmeric/i.test(decodeURIComponent(u))
  )
  expect(leaks).toEqual([])
}

test('provider: scribe detects products, provider maps + confirms, "Approve & send" builds the cart', async ({
  page,
}) => {
  const urls = watchUrls(page)
  const console = `/dashboard/provider/visits/${seed!.rxVisitRecordId}/scribe`
  await signIn(page, seed!.emails.provider, console)

  await page.getByRole('button', { name: 'Start Documentation Session' }).click()
  await page.getByRole('button', { name: 'Demo: simulate conversation' }).click()

  const panel = page.getByRole('region', { name: 'Detected products' })
  await expect(panel.getByText('Magnesium Glycinate × 2')).toBeVisible()
  await expect(panel.getByText('Arnica Gel × 1')).toBeVisible()
  await expect(panel.getByText('Tramadol × 1')).toBeVisible()
  await expect(panel.getByText('e-Prescribe', { exact: true })).toBeVisible()
  await expect(panel.getByText('Turmeric complex × 1')).toBeVisible()

  await panel.getByLabel('Map Turmeric complex to a product').selectOption({
    label: 'Turmeric Curcumin — $18.00',
  })
  await expect(panel.getByText('Turmeric Curcumin × 1')).toBeVisible()

  const send = page.getByRole('button', { name: 'Approve & send' })
  await expect(send).toBeDisabled()
  await panel.getByLabel('I confirm these products for this patient').check()
  await send.click()

  await expect(page.getByText(/3 products sent to the patient's cart/)).toBeVisible()
  await expect(page.getByText("Sent: 3 to the patient's cart, 1 to e-prescribe")).toBeVisible()
  expectNoPhiInUrls(urls)
})

test('patient: sees "Prescribed · Dr. X", accepts / declines, and (no card yet) gets the regular checkout', async ({
  page,
}) => {
  const urls = watchUrls(page)
  await signIn(page, seed!.emails.patient, '/checkout')

  await expect(page.getByText('Prescribed · Dr. Synthetic Provider')).toHaveCount(3)
  await page.getByRole('button', { name: 'Accept Magnesium Glycinate' }).click()
  await page.getByRole('button', { name: 'Accept Turmeric Curcumin' }).click()
  await page.getByRole('button', { name: 'Decline Arnica Gel' }).click()
  await expect(page.getByText('Declined — not charged')).toBeVisible()
  // The scheduled Rx went to e-prescribe — it is not in the cart.
  await expect(page.getByText('Tramadol')).toHaveCount(0)
  // Magnesium 2 × $24 + turmeric $18 = $66; arnica declined.
  await expect(page.getByText('$66.00').first()).toBeVisible()
  // No card on file without Stripe keys: the regular checkout is offered.
  await expect(page.getByRole('button', { name: 'Secure Checkout' })).toBeVisible()
  expectNoPhiInUrls(urls)
})
