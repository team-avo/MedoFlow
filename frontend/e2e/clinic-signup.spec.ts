/**
 * Demo feedback WS4 — the new-clinic path, in the browser (mocked API):
 * landing "Start free trial" → pricing → pick a plan → sign-up form (live
 * web-address check) → signed in → the clinic application (practice details).
 * Plus the demo banner when the server runs BILLING_MODE=demo.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAFF_EMAIL, STAFF_PASSWORD, installMockApi, ok, fail } from './mockApi'

const API = 'http://127.0.0.1:3999/api/v1'

const PLANS = (billingMode: 'trial' | 'demo') => ({
  billingMode,
  trialDays: 14,
  plans: [
    {
      key: 'FREE',
      name: 'Free',
      monthlyPrice: 0,
      tagline: 'Solo',
      highlights: ['Booking'],
      selfServe: true,
    },
    {
      key: 'STARTER',
      name: 'Starter',
      monthlyPrice: 49,
      tagline: 'Small',
      highlights: ['AI scribe'],
      selfServe: true,
    },
    {
      key: 'GROWTH',
      name: 'Growth',
      monthlyPrice: 149,
      tagline: 'Growing',
      highlights: ['Video consultations'],
      selfServe: true,
      recommended: true,
    },
    {
      key: 'ENTERPRISE',
      name: 'Enterprise',
      monthlyPrice: null,
      tagline: 'Groups',
      highlights: ['BAA'],
      selfServe: false,
    },
  ],
})

async function mockTenants(page: Page, billingMode: 'trial' | 'demo' = 'trial') {
  const calls: { key: string; body: Record<string, unknown> }[] = []
  await page.route(`${API}/tenants/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const url = new URL(req.url())
    const key = `${req.method()} ${url.pathname.replace(/^\/api\/v1/, '')}`
    calls.push({ key, body: (req.postDataJSON?.() ?? {}) as Record<string, unknown> })
    if (key === 'GET /tenants/plans') return ok(route, PLANS(billingMode))
    if (key === 'GET /tenants/check-subdomain') {
      return ok(route, { available: url.searchParams.get('subdomain') !== 'taken-clinic' })
    }
    if (key === 'POST /tenants/signup') {
      const body = req.postDataJSON() as { subdomain: string; plan: string }
      if (body.subdomain === 'taken-clinic')
        return fail(route, 409, 'conflict', 'This subdomain is already taken.')
      return ok(route, {
        tenantId: 't-new',
        clinicId: 'clinic-e2e',
        subdomain: body.subdomain,
        plan: body.plan,
        status: billingMode === 'demo' ? 'ACTIVE' : 'TRIAL',
        trialEndsAt: null,
        siteUrl: `https://${body.subdomain}.example.test`,
      })
    }
    return route.fallback()
  })
  return calls
}

test('landing → pricing → plan → sign up → signed in, on to onboarding', async ({ page }) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', newClinic: true })
  const calls = await mockTenants(page)

  await page.goto('/')
  await page.getByRole('link', { name: 'Start free trial' }).first().click()
  await expect(page).toHaveURL(/\/pricing$/)
  await expect(page.getByTestId('plan-cards')).toContainText('Growth')
  await expect(page.getByRole('link', { name: 'Contact sales' })).toHaveAttribute(
    'href',
    /^mailto:/
  )
  await page.getByRole('link', { name: 'Start free trial — Growth' }).click()

  await expect(page).toHaveURL(/\/get-started\?plan=GROWTH$/)
  await expect(page.getByRole('radio', { name: /Growth/ })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: /Starter/ }).click()

  await page.getByLabel('Clinic name').fill('Sunrise Family Clinic')
  // The web address is suggested from the name, and checked live.
  await expect(page.getByLabel('Your website address')).toHaveValue('sunrise-family-clinic')
  await expect(page.getByTestId('subdomain-status')).toHaveText(/Available/)
  await page.getByLabel('Clinic email').fill('hello@sunrise.example.test')
  await page.getByLabel('Your name').fill('Owner Synthetic')
  // The mock signs in only this synthetic identity.
  await page.getByLabel('Your email').fill(STAFF_EMAIL)
  await page.getByLabel('Password').fill(STAFF_PASSWORD)
  await page.getByRole('button', { name: 'Create my clinic' }).click()

  // Signed in and held in the clinic application (clinic-onboarding.spec.ts).
  await expect(page).toHaveURL(/\/practice$/)
  await expect(page.getByRole('heading', { name: 'Tell us about your practice' })).toBeVisible()
  const signup = calls.find((c) => c.key === 'POST /tenants/signup')!
  expect(signup.body).toMatchObject({
    plan: 'STARTER',
    subdomain: 'sunrise-family-clinic',
    clinicName: 'Sunrise Family Clinic',
    ownerEmail: STAFF_EMAIL,
  })
})

test('a taken web address is flagged before submit and refused by the server', async ({ page }) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', newClinic: true })
  await mockTenants(page)
  await page.goto('/get-started?plan=FREE')
  await page.getByLabel('Clinic name').fill('Anything')
  const address = page.getByLabel('Your website address')
  await address.fill('taken-clinic')
  await expect(page.getByTestId('subdomain-status')).toHaveText(/Already taken/)
  await page.getByLabel('Clinic email').fill('a@b.example.test')
  await page.getByLabel('Your name').fill('Owner')
  await page.getByLabel('Your email').fill('owner@example.test')
  await page.getByLabel('Password').fill('Synthetic-Pass-123')
  await page.getByRole('button', { name: 'Create my clinic' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /taken/i })).toBeVisible()
  await expect(page).toHaveURL(/\/get-started/)
})

test('demo environment: plans are illustrative, everything unlocked', async ({ page }) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', newClinic: true })
  await mockTenants(page, 'demo')
  await page.goto('/pricing')
  await expect(page.getByTestId('demo-plans-banner')).toContainText(/plans are illustrative/i)
  await expect(page.getByRole('link', { name: 'Create your clinic — Growth' })).toBeVisible()
  await expect(page.getByText(/14-day free trial/)).toHaveCount(0)
})
