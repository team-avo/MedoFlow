import { expect, type Page } from '@playwright/test'
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
