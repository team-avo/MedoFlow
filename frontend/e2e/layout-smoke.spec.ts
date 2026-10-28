/**
 * Frontend smoothness pass — layout & navigation smoke, per role.
 *
 *  - Every nav link a role sees is clicked (client-side, as a user would):
 *    the page renders (no "Application error", 404 or error boundary), and
 *    no full-viewport loading overlay blocks the screen at any point.
 *  - Every page is loaded at phone (375), tablet (820) and desktop (1280)
 *    widths with a deliberately long name / email / clinic name: the page
 *    must not scroll sideways.
 *
 * The API is the generic mock (e2e/mockApi.ts, plus e2e/siteMock.ts for the
 * website builder): every other call answers an empty success, so this
 * checks the chrome, empty and loading states, not data rendering. Checks
 * are soft so one run reports every offender.
 */
import { expect, test, type Page } from '@playwright/test'
import { installMockApi, ok, type MockRole } from './mockApi'
import { installSiteMock, newSiteState } from './siteMock'

test.use({ timezoneId: 'UTC', locale: 'en-US' })
// Each test crawls every route a role can reach (up to ~25 pages).
test.describe.configure({ timeout: 240_000 })

const LONG_IDENTITY = {
  name: 'Maximiliana Alexandrina Featherstonehaugh-Worthington',
  email: 'maximiliana.featherstonehaugh-worthington@long-clinic-domain.example.test',
  clinicName: 'Northside Integrated Physiotherapy and Sports Rehabilitation Centre',
}

type RolePlan = {
  role: MockRole
  start: string
  /**
   * This role's navigation links. Scoped to the <nav> list: the sidebar logo
   * (/dashboard) and promo card redirect per role, so they are not nav targets.
   */
  navSelector: string
  /** Routes not promoted in the nav but reachable by URL. */
  extra: string[]
}

const ROLES: RolePlan[] = [
  {
    role: 'SUPER_ADMIN',
    start: '/dashboard/admin',
    navSelector: 'aside nav a[href^="/dashboard"]',
    extra: [
      '/dashboard/disciplines',
      '/dashboard/locations',
      '/dashboard/settings',
      '/dashboard/staff/roles',
      '/dashboard/site/domains',
      '/dashboard/site/redirects',
      '/dashboard/site/media',
      '/dashboard/voice-agent',
    ],
  },
  {
    role: 'FRONT_DESK',
    start: '/dashboard/front-desk',
    navSelector: 'aside nav a[href^="/dashboard"]',
    extra: [],
  },
  {
    role: 'PROVIDER',
    start: '/dashboard',
    navSelector: 'aside nav a[href^="/dashboard"]',
    extra: ['/dashboard/provider/calendar', '/dashboard/provider/profile'],
  },
  {
    role: 'MARKETING',
    start: '/dashboard/site',
    navSelector: 'aside nav a[href^="/dashboard"]',
    extra: [],
  },
  {
    role: 'PATIENT',
    start: '/account',
    navSelector: 'aside nav a[href^="/account"]',
    extra: ['/account/profile', '/store'],
  },
  {
    role: 'PLATFORM_ADMIN',
    start: '/platform/clinics',
    navSelector: 'header nav a[href^="/platform"]',
    extra: [],
  },
]

/**
 * Counts, every animation frame, how long an element with role="status"
 * covers (nearly) the whole viewport — i.e. a blocking loading overlay.
 */
async function trackBlockingOverlay(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __mfBlockingMs: number }
    w.__mfBlockingMs = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const vw = window.innerWidth
      const vh = window.innerHeight
      for (const el of Array.from(document.querySelectorAll('[role="status"]'))) {
        const r = el.getBoundingClientRect()
        const covered =
          (Math.min(r.right, vw) - Math.max(r.left, 0)) *
          (Math.min(r.bottom, vh) - Math.max(r.top, 0))
        if (covered >= vw * vh * 0.9 && getComputedStyle(el).visibility !== 'hidden') {
          w.__mfBlockingMs += dt
          break
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/** Endpoints whose screens need a shaped (empty) answer rather than `{}`. */
const SHAPED_EMPTY: Record<string, unknown> = {
  '/platform/clinics': { items: [], total: 0 },
  '/roles/permissions': { groups: [], presets: {} },
}

async function signIn(page: Page, role: MockRole) {
  await installMockApi(page, { role, signedIn: true, identity: LONG_IDENTITY })
  await installSiteMock(page, newSiteState())
  await page.route(
    /http:\/\/127\.0\.0\.1:3999\/api\/v1\/(platform\/clinics|roles\/permissions)(\?|$)/,
    (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback()
      const path = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, '')
      return ok(route, SHAPED_EMPTY[path])
    }
  )
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  // Long enough for any debounced loader (the old one waited 400–600 ms).
  await page.waitForTimeout(800)
}

async function expectPageRendered(page: Page, where: string) {
  const body = page.locator('body')
  await expect.soft(body, `${where}: application error`).not.toContainText('Application error')
  await expect.soft(body, `${where}: crashed`).not.toContainText('This page couldn’t load')
  await expect.soft(body, `${where}: 404`).not.toContainText('This page could not be found')
  await expect
    .soft(body, `${where}: error boundary`)
    .not.toContainText('This page hit an unexpected error')
}

/** Horizontal overflow in px (0 = none) plus the widest offenders, for the report. */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const by = document.documentElement.scrollWidth - vw
    const offenders: string[] = []
    if (by > 1) {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > vw + 1) {
          const cls = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 4).join('.')
          offenders.push(
            `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} (+${Math.round(r.right - vw)}px)`
          )
          if (offenders.length >= 3) break
        }
      }
    }
    return { by: by > 1 ? by : 0, offenders }
  })
}

for (const plan of ROLES) {
  test.describe(`${plan.role}`, () => {
    test(`every nav link renders without a blocking loader`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await trackBlockingOverlay(page)
      await signIn(page, plan.role)
      await page.setViewportSize({ width: 1280, height: 800 })

      await page.goto(plan.start)
      await settle(page)
      await expectPageRendered(page, plan.start)

      const navHrefs = [
        ...new Set(
          await page
            .locator(plan.navSelector)
            .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
        ),
      ].filter(Boolean)
      expect(navHrefs.length, 'the role has navigation links').toBeGreaterThan(0)
      const hrefs = navHrefs.filter((h) => h !== plan.start)

      // Only client-side navigations count: the first hard load may show the
      // app-boot screen.
      await page.evaluate(() => {
        ;(window as unknown as { __mfBlockingMs: number }).__mfBlockingMs = 0
      })
      for (const href of hrefs) {
        await page.locator(`${plan.navSelector}[href="${href}"]`).first().click()
        await page.waitForURL((u) => u.pathname === href.split('?')[0], { timeout: 15_000 })
        await settle(page)
        await expectPageRendered(page, href)
      }
      const blockingMs = await page.evaluate(
        () => (window as unknown as { __mfBlockingMs: number }).__mfBlockingMs
      )
      console.log(
        `[smoke] ${plan.role}: ${hrefs.length} nav links, blocking overlay ${Math.round(blockingMs)} ms`
      )
      expect.soft(Math.round(blockingMs), 'ms a full-screen loader blocked the UI').toBe(0)
      expect.soft(errors, 'uncaught page errors').toEqual([])
    })

    for (const width of [375, 820, 1280]) {
      test(`no sideways scroll at ${width}px`, async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message))
        await signIn(page, plan.role)
        await page.setViewportSize({ width: 1280, height: 800 })
        await page.goto(plan.start)
        await settle(page)
        const navHrefs = await page
          .locator(plan.navSelector)
          .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
        const routes = [...new Set([plan.start, ...navHrefs, ...plan.extra])].filter(Boolean)

        await page.setViewportSize({ width, height: 900 })
        for (const route of routes) {
          await page.goto(route)
          await settle(page)
          await expectPageRendered(page, `${route} @${width}`)
          const { by, offenders } = await horizontalOverflow(page)
          if (by)
            console.log(`[smoke] OVERFLOW ${width}px ${route} by ${by}px: ${offenders.join(', ')}`)
          expect.soft(by, `${route} @${width}px scrolls sideways`).toBe(0)
        }
        expect.soft(errors, 'uncaught page errors').toEqual([])
      })
    }
  })
}

test.describe('public', () => {
  for (const width of [375, 820, 1280]) {
    test(`landing and store render without sideways scroll at ${width}px`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await installMockApi(page)
      await page.setViewportSize({ width, height: 900 })
      for (const route of ['/', '/store']) {
        await page.goto(route)
        await settle(page)
        await expectPageRendered(page, `${route} @${width}`)
        const { by, offenders } = await horizontalOverflow(page)
        if (by)
          console.log(`[smoke] OVERFLOW ${width}px ${route} by ${by}px: ${offenders.join(', ')}`)
        expect.soft(by, `${route} @${width}px scrolls sideways`).toBe(0)
      }
      expect.soft(errors, 'uncaught page errors').toEqual([])
    })
  }
})
