/**
 * CTO-23 AC5: LIVE recorded run of Khush's test path against a real backend
 * (no mocks): a brand-new clinic with NO website.
 *
 *   1. sign up → the application → straight to the dashboard (no website page)
 *   a. the owner books a walk-in for a new patient (CTO-24)
 *   b. starts the scribe from the list and runs it to "Approve & send" (CTO-30)
 *   c. adds a product to the Storefront and sets its stock
 *   d. the patient opens the MedoFlow checkout link (CTO-32) and pays
 *
 * Opt-in: runs only when E2E_LIVE_API is set. The backend needs
 * CLINIC_REVIEW_MODE=auto, the mock AI scribe, and a frontend built with
 * NEXT_PUBLIC_API_URL pointing at it. Video is recorded for every step.
 *
 *   E2E_LIVE_API=http://127.0.0.1:3999 E2E_EXTERNAL_SERVER=1 \
 *   pnpm exec playwright test e2e/live-fresh-clinic.spec.ts
 */
import { expect, test, type Browser, type Page } from '@playwright/test'

const LIVE = process.env.E2E_LIVE_API
const RUN = Date.now().toString(36)
const PASSWORD = `Synthetic-Fresh-${RUN}-2026!`
const OWNER_EMAIL = `owner.${RUN}@example.test`
const PATIENT_EMAIL = `walkin.${RUN}@example.test`
const CLINIC_NAME = `Fresh Longevity ${RUN}`
const NPI = '1234567893'

test.describe.configure({ mode: 'serial' })
test.skip(!LIVE, 'live check: set E2E_LIVE_API (see the CTO feedback walkthrough §4)')
test.use({
  timezoneId: 'America/Chicago',
  locale: 'en-US',
  video: 'on',
  viewport: { width: 1280, height: 800 },
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
})
test.setTimeout(5 * 60_000)

/** Shared across the serial steps. */
const run = { inviteLink: '', checkoutLink: '', urls: [] as string[] }

/** Every page the owner actually opens (prefetches of sidebar links don't count). */
function watchSitePages(page: Page) {
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) run.urls.push(new URL(frame.url()).pathname)
  })
}

async function signIn(page: Page, email: string, returnUrl: string) {
  await page.goto(`/?auth=login&returnUrl=${encodeURIComponent(returnUrl)}`)
  await page.getByLabel(/email/i).first().fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

let ownerPage: Page
test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({
    recordVideo: { dir: test.info().outputDir, size: { width: 1280, height: 800 } },
    viewport: { width: 1280, height: 800 },
    timezoneId: 'America/Chicago',
    permissions: ['microphone'],
  })
  ownerPage = await ctx.newPage()
  watchSitePages(ownerPage)
})
test.afterAll(async () => {
  await ownerPage?.context().close()
})

test('1. sign up → application → dashboard, without opening a website page', async () => {
  const page = ownerPage
  await page.goto('/get-started?plan=FREE')
  await page.getByLabel('Clinic name').fill(CLINIC_NAME)
  await expect(page.getByTestId('subdomain-status')).toHaveText(/Available/)
  await page.getByLabel('Clinic email').fill(`clinic.${RUN}@example.test`)
  await page.getByLabel('Your name').fill('Khush Owner')
  await page.getByLabel('Your email').fill(OWNER_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create my clinic' }).click()

  // Practice details.
  await expect(page).toHaveURL(/\/practice$/)
  await page.locator('#legalName').fill('Fresh Longevity LLC')
  await page.locator('#practiceType').selectOption('LONGEVITY_MEDICAL')
  await page.locator('#locationCount').fill('1')
  await page.locator('#addressLine1').fill('1 Fresh Street')
  await page.locator('#city').fill('Austin')
  await page.locator('#state').selectOption('TX')
  await page.locator('#postalCode').fill('73301')
  await page.locator('#timezone').selectOption('America/Chicago')
  await page.locator('#groupNpi').fill(NPI)
  await page.locator('#federalTaxId').fill('12-3456789')
  await page.locator('#estimatedSeats').click()
  await page.keyboard.type('1')
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // Practitioners: the owner is row 0 and sees patients.
  await expect(page).toHaveURL(/\/practitioners$/)
  await expect(page.getByLabel('I see patients')).toBeChecked()
  await page.locator('#p0-title').selectOption('Medical Director')
  await page.locator('#p0-npi').fill(NPI)
  await page.locator('#p0-cred').fill('MD')
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // Agreement.
  await expect(page).toHaveURL(/\/agreement$/)
  await page.getByLabel('I agree to all of the above').check()
  await page.getByLabel(/read and agree to the authorization/).check()
  const printed = await page.locator('#signerName').inputValue()
  await page.locator('#signature').fill(printed)
  await page.getByRole('button', { name: /Sign & submit application/ }).click()
  const confirm = page.getByRole('dialog')
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.getByLabel('Clinic name').fill(CLINIC_NAME)
    await confirm.getByRole('button', { name: 'Confirm & submit' }).click()
  }

  // CTO-25: straight to the dashboard (auto review approves at once).
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/dashboard/admin')
  await expect(page.getByTestId('setup-checklist')).toContainText('Quick setup')
})

test('c. a product in the Storefront, with stock', async () => {
  const page = ownerPage
  await page.goto('/dashboard/products')
  await page
    .getByRole('button', { name: /Add (First )?Product/ })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Product Name').fill('Magnesium Glycinate')
  await dialog.getByLabel('Price ($)').fill('24')
  await dialog.getByLabel('Classification').selectOption('SUPPLEMENT')
  await dialog.getByRole('button', { name: 'Add Product' }).click()
  await expect(page.getByText('Magnesium Glycinate')).toBeVisible()
  await expect(page.getByText('0 in stock')).toBeVisible()

  await page.getByRole('button', { name: 'Adjust stock for Magnesium Glycinate' }).click()
  await page.getByLabel('Stock for Magnesium Glycinate').fill('10')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('10 in stock')).toBeVisible()
})

test('a. the owner books a walk-in for a new patient', async () => {
  const page = ownerPage
  // A discipline and a service to book (a solo practice's one provider offers it).
  await page.goto('/dashboard/disciplines')
  await page.getByRole('button', { name: 'Add Discipline' }).first().click()
  await page.getByRole('dialog').getByPlaceholder('e.g. Physical Therapy').fill('Longevity')
  await page.getByRole('dialog').getByRole('button', { name: 'Create Discipline' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.goto('/dashboard/services')
  await page.getByRole('button', { name: 'Add Service' }).click()
  const svc = page.getByRole('dialog')
  await svc.getByPlaceholder('e.g. Initial Consultation').fill('Longevity consult')
  await svc.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Longevity' }).click()
  await svc.locator('input[name="duration"]').fill('30')
  await svc.getByPlaceholder('0.00').fill('0')
  await svc.getByRole('button', { name: 'Create Service' }).click()
  await expect(page.getByText('Longevity consult').first()).toBeVisible()

  await page.goto('/dashboard/appointments')
  await page.getByRole('button', { name: 'New appointment' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'New patient' }).click()
  await dialog.getByLabel('Patient name').fill('Walk In Patient')
  await dialog.getByLabel('Patient email').fill(PATIENT_EMAIL)
  const serviceId = await dialog
    .getByLabel('Service')
    .locator('option', { hasText: 'Longevity consult' })
    .getAttribute('value')
  await dialog.getByLabel('Service').selectOption(serviceId!)
  await dialog.getByLabel('Clinician').selectOption({ index: 1 })
  await dialog.getByRole('button', { name: 'Walk-in, now' }).click()
  await expect(dialog.getByTestId('chosen-time')).toBeVisible()
  await dialog.getByRole('button', { name: 'Book appointment' }).click()
  await expect(dialog.getByTestId('invite-link')).toBeVisible()
  run.inviteLink = await dialog.getByLabel('Patient invite link').inputValue()
  expect(run.inviteLink).toMatch(/set-password\?token=/)
  await page.keyboard.press('Escape')
})

test('b. Start scribe from the list → consent → record → Approve & send', async () => {
  const page = ownerPage
  await page.goto('/dashboard/appointments')
  await page
    .getByRole('link', { name: /Start scribe/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/consultation\?autostart=1/)

  const controls = page.getByTestId('consult-controls')
  await page
    .getByTestId('in-person-consent')
    .getByRole('button', { name: 'The patient agreed' })
    .click()
  await expect(controls.getByRole('button', { name: /stop recording/i })).toBeVisible()
  await page.waitForTimeout(4000) // a few seconds of the fake microphone
  await controls.getByRole('button', { name: /stop recording/i }).click()
  await controls.getByRole('button', { name: /upload & transcribe/i }).click()

  const send = page.getByRole('button', { name: /Approve & send/ })
  await expect(send).toBeVisible({ timeout: 90_000 })
  const panel = page.getByRole('region', { name: 'Detected products' })
  await expect(panel).toContainText(/Magnesium Glycinate/i)
  // CTO-33: the key change (a new product) is approved; the provider confirms.
  await expect(panel.getByText('Key changes to approve')).toBeVisible()
  await page.getByLabel('I confirm these products for this patient').check()
  const response = page.waitForResponse(
    (r) => /\/ai-scribe\/session\/[^/]+\/approve$/.test(r.url()) && r.request().method() === 'POST'
  )
  await send.click()
  const approved = await (await response).json()
  expect(approved.data.session.rxCart.checkoutLink.kind).toBe('medoflow')
  run.checkoutLink = approved.data.session.rxCart.checkoutLink.url as string
  expect(run.checkoutLink).toMatch(/\/c\/[^/]+\/cart\?t=/)
})

test('d. the patient sets a password, opens the checkout link and pays', async ({ browser }) => {
  const ctx = await browser.newContext({
    recordVideo: { dir: test.info().outputDir, size: { width: 1280, height: 800 } },
    viewport: { width: 1280, height: 800 },
  })
  const page = await ctx.newPage()
  const invite = new URL(run.inviteLink)
  await page.goto(`${invite.pathname}${invite.search}`)
  await page.locator('#password').fill(PASSWORD)
  await page.locator('#confirmPassword').fill(PASSWORD)
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(page.getByText(/password (has been )?set|success/i).first()).toBeVisible()

  const link = new URL(run.checkoutLink)
  const cartPath = `${link.pathname}${link.search}`
  await signIn(page, PATIENT_EMAIL, cartPath)
  await expect(page).toHaveURL(/\/checkout\?clinic=/, { timeout: 30_000 })
  // Prescribed items are accepted (or declined) by the patient before paying.
  await page.getByRole('button', { name: 'Accept Magnesium Glycinate' }).click()
  await page.getByRole('button', { name: 'Simulate Demo Payment' }).click()
  await expect(page.getByText(/Payment received/)).toBeVisible({ timeout: 30_000 })
  await ctx.close()
})

test('no website page was ever opened', async () => {
  expect(run.urls.filter((u) => u.startsWith('/dashboard/site'))).toEqual([])
})
