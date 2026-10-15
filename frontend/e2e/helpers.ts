import { expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { STAFF_EMAIL, STAFF_PASSWORD } from './mockApi'

/** Opens the sign-in dialog and submits the password step. */
export async function submitPassword(page: Page, returnUrl = '/dashboard/settings') {
  await page.goto(`/?auth=login&returnUrl=${encodeURIComponent(returnUrl)}`)
  const email = page.getByLabel('Work email')
  await expect(email).toBeVisible()
  await email.fill(STAFF_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(STAFF_PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

export async function expectOnSecurityPage(page: Page) {
  await expect(page).toHaveURL(/\/dashboard\/settings$/)
  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible()
}

/** axe scan of one region: no serious or critical violations. */
export async function expectNoSeriousA11yViolations(page: Page, include: string) {
  // Dialogs fade/zoom in; contrast measured mid-animation is meaningless.
  // Wait until nothing in the region is animating and it is fully opaque.
  const region = page.locator(include).first()
  await expect
    .poll(() =>
      region.evaluate(
        (el) =>
          el.getAnimations({ subtree: true }).every((a) => a.playState !== 'running') &&
          getComputedStyle(el).opacity === '1'
      )
    )
    .toBe(true)
  const results = await new AxeBuilder({ page }).include(include).analyze()
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  )
  const describe = (v: (typeof serious)[number]) =>
    `${v.id}: ${v.help} → ${v.nodes.map((n) => `${n.target.join(' ')} [${n.any.map((c) => c.message).join(' | ')}]`).join('; ')}`
  expect(serious.map(describe)).toEqual([])
}
