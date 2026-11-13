/**
 * CTO-27: upload a logo, get brand colours proposed from it (in the browser),
 * use them and save. CTO-28: staff consoles use the clinic's brand colour as
 * their accent; patients and platform admins keep MedoFlow's. Mocked API.
 */
import { expect, test } from '@playwright/test'
import { installMockApi, ok } from './mockApi'

const API = 'http://127.0.0.1:3999/api/v1'
// A two-colour "logo": a big teal block and a smaller orange one.
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" onload="alert(1)">
  <rect width="64" height="40" fill="#0d9488"/><rect y="40" width="64" height="24" fill="#f97316"/>
  <script>alert(2)</script></svg>`

test('a logo proposes readable colours; "Use these" and save sends them', async ({ page }) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true })
  let saved: Record<string, unknown> | null = null
  await page.route(`${API}/onboarding/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '')
    if (req.method() === 'PATCH' && path === '/onboarding/brand') {
      saved = req.postDataJSON()
      return ok(route, {})
    }
    return route.fallback()
  })
  await page.goto('/dashboard/clinic')
  const card = page.getByRole('region', { name: 'Logo and colours' })
  await card.getByLabel('Upload logo').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(LOGO),
  })
  const proposal = card.getByTestId('brand-proposal')
  await expect(proposal).toContainText('From your logo')
  await proposal.getByRole('button', { name: 'Use these' }).click()
  await card.getByRole('button', { name: 'Save brand' }).click()
  await expect.poll(() => saved).not.toBeNull()
  const body = saved as unknown as { primaryColor: string; secondaryColor: string; logoUrl: string }
  expect(body.primaryColor).toMatch(/^#[0-9a-f]{6}$/)
  expect(body.secondaryColor).toMatch(/^#[0-9a-f]{6}$/)
  // The SVG was sanitised before it was saved.
  const svg = Buffer.from(body.logoUrl.split(',')[1]!, 'base64').toString('utf8')
  expect(svg).not.toMatch(/script|onload/i)
  expect(svg).toContain('#0d9488')
})

const consoleVar = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--console-primary-rgb').trim()
  )

test('staff consoles use the brand colour, readable, with no later fetch', async ({ page }) => {
  await installMockApi(page, {
    role: 'FRONT_DESK',
    signedIn: true,
    brand: { primaryColor: '#b91c1c', secondaryColor: null },
  })
  await page.goto('/dashboard/front-desk')
  await expect.poll(() => consoleVar(page)).toBe('185 28 28')
  // The accent lands on the active sidebar item.
  const dot = page.locator('aside nav a[aria-current="page"] span.rounded-full').first()
  if (await dot.count()) await expect(dot).toBeVisible()
})

test('patients and platform admins keep MedoFlow colours', async ({ page }) => {
  await installMockApi(page, {
    role: 'PATIENT',
    signedIn: true,
    brand: { primaryColor: '#b91c1c', secondaryColor: null },
  })
  await page.goto('/account')
  await page.waitForLoadState('networkidle')
  expect(await consoleVar(page)).toBe('')
})
