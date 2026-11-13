/**
 * CTO-26: after Publish the owner sees the address going live, live, or
 * failed with a reason and Retry (Cloudflare stubbed in the mocked API).
 */
import { expect, test } from '@playwright/test'
import { installMockApi, ok } from './mockApi'
import { installSiteMock, newSiteState } from './siteMock'

test('a failed launch shows the reason; Retry puts the address live', async ({ page }) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true })
  const site = newSiteState()
  site.templateKey = 'clarity'
  site.publishedAt = '2026-11-12T10:00:00.000Z'
  site.pages.push({
    id: 'page-home',
    kind: 'HOME',
    slug: '',
    title: 'Home',
    draftTitle: 'Home',
    status: 'PUBLISHED',
    version: 1,
    draft: [],
    live: [],
    showInNav: true,
    navOrder: 0,
    noindex: false,
  } as unknown as (typeof site.pages)[number])
  await installSiteMock(page, site)
  let status: 'FAILED' | 'PENDING' | 'LIVE' = 'FAILED'
  let retried = 0
  await page.route('http://127.0.0.1:3999/api/v1/site/launch**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    if (req.method() === 'POST') {
      retried += 1
      status = 'PENDING'
      setTimeout(() => (status = 'LIVE'), 500)
      return ok(route, { status: 'PENDING' })
    }
    return ok(route, {
      status,
      label: 'everwell',
      url: status === 'LIVE' ? 'https://everwell.medoflow.pages.dev' : null,
      lastError: status === 'FAILED' ? 'Cloudflare answered 500' : null,
      attempts: 3,
    })
  })
  await page.goto('/dashboard/site')
  const box = page.getByTestId('site-launch')
  await expect(box).toContainText("didn't go live: Cloudflare answered 500")
  await box.getByRole('button', { name: 'Retry' }).click()
  await expect(box).toContainText('Putting your address live')
  await expect(box).toContainText('everwell.medoflow.pages.dev', { timeout: 15_000 })
  expect(retried).toBe(1)
})
