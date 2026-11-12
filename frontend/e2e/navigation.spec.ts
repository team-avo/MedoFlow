/**
 * Sidebar and navigation after the CTO demo feedback (mocked API):
 *
 *  - CTO-01: the provider's list is "Appointments", not "Queue".
 *  - CTO-02: no "Video Room" tab; /dashboard/provider/meetings without a
 *    Google ?code redirects to Appointments (never a 404 or a dead page).
 *  - CTO-03: providers have no Store tab.
 *  - CTO-20: the owner's sidebar has one Commerce group (Services, Storefront,
 *    Packages, Memberships, Billing, Commissions), no Catalog, and Settings
 *    last (Clinic profile, Locations & hours, Disciplines, Forms, Security).
 */
import { expect, test, type Page } from '@playwright/test'
import { installMockApi, type MockRole } from './mockApi'

async function sidebar(page: Page, role: MockRole, start: string) {
  await installMockApi(page, { role, signedIn: true })
  await page.goto(start)
  const nav = page.locator('aside nav').first()
  await expect(nav).toBeVisible()
  return nav
}

/** Section titles, in order, as the sidebar shows them. */
const sectionTitles = (nav: ReturnType<Page['locator']>) =>
  nav.locator('[data-testid="sidebar-section-title"]').allInnerTexts()

test('provider: Appointments (not Queue), no Video Room, no Store', async ({ page }) => {
  const nav = await sidebar(page, 'PROVIDER', '/dashboard')
  await expect(nav.getByRole('link', { name: 'Appointments' })).toHaveAttribute(
    'href',
    '/dashboard/appointments'
  )
  await expect(nav.getByText('Queue', { exact: true })).toHaveCount(0)
  await expect(nav.getByText('Video Room')).toHaveCount(0)
  await expect(nav.getByText('Telehealth')).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Store' })).toHaveCount(0)
  await expect(nav.locator('a[href="/store"]')).toHaveCount(0)
})

test('the old Video Room URL redirects to Appointments', async ({ page }) => {
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  await page.goto('/dashboard/provider/meetings')
  await expect(page).toHaveURL(/\/dashboard\/appointments$/)
  await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible()
})

test('owner: one Commerce group, no Catalog, Settings last', async ({ page }) => {
  const nav = await sidebar(page, 'SUPER_ADMIN', '/dashboard/admin')
  const titles = await sectionTitles(nav)
  expect(titles.map((t) => t.trim().toLowerCase())).not.toContain('catalog')
  expect(titles.at(-1)?.trim().toLowerCase()).toBe('settings')

  const commerce = nav.locator('[data-testid="sidebar-section"][data-section="Commerce"]')
  await expect(commerce.getByRole('link')).toHaveText([
    'Services',
    'Storefront',
    'Packages',
    'Memberships',
    'Billing',
    'Commissions',
  ])
  const settings = nav.locator('[data-testid="sidebar-section"][data-section="Settings"]')
  await expect(settings.getByRole('link')).toHaveText([
    'Clinic profile',
    'Locations & hours',
    'Disciplines',
    'Forms',
    'Security',
  ])
})

test('front desk: same names where they overlap, Forms under Settings', async ({ page }) => {
  const nav = await sidebar(page, 'FRONT_DESK', '/dashboard/front-desk')
  const titles = (await sectionTitles(nav)).map((t) => t.trim().toLowerCase())
  expect(titles.at(-1)).toBe('settings')
  const settings = nav.locator('[data-testid="sidebar-section"][data-section="Settings"]')
  await expect(settings.getByRole('link', { name: 'Forms' })).toBeVisible()
  await expect(nav.getByText('Intake Forms')).toHaveCount(0)
})
