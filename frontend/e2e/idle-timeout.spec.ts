/**
 * F0.2.1 — after the idle window the user sees a warning, then is signed
 * out, and protected data is cleared from the screen.
 */
import { expect, test } from '@playwright/test'
import { installMockApi } from './mockApi'
import { expectOnSecurityPage, submitPassword } from './helpers'

test('idle: warning one minute before the window ends, then sign-out with the screen cleared', async ({
  page,
}) => {
  await page.clock.install()
  const api = await installMockApi(page, { idleTimeoutMinutes: 15 })
  await submitPassword(page)
  await expectOnSecurityPage(page)
  await expect(page.getByText('signed out after 15 minutes without activity')).toBeVisible()

  // 13 min 50 s idle: no warning yet.
  await page.clock.fastForward('13:50')
  await expect(page.getByTestId('idle-warning')).toBeHidden()

  // Past 14 min: the warning appears with a countdown and focus on "Stay signed in".
  await page.clock.fastForward('00:20')
  const warning = page.getByRole('alertdialog')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('Are you still there?')
  await expect(page.getByTestId('idle-countdown')).toHaveText(/^\d+s$/)
  await expect(page.getByRole('button', { name: 'Stay signed in' })).toBeFocused()

  // Let it run out.
  await page.clock.fastForward('01:00')
  await expect(page).toHaveURL(/reason=idle/)
  expect(api.calls).toContain('POST /auth/logout')

  // Protected content is gone; the sign-in dialog explains why.
  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toHaveCount(0)
  await expect(page.getByText('Synthetic Front Desk')).toHaveCount(0)
  await expect(page.getByText(/signed out after a period of inactivity/)).toBeVisible()

  // Going back to the protected URL does not bring the data back.
  await page.goto('/dashboard/settings')
  await expect(page).toHaveURL(/auth=login|returnUrl=/)
  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toHaveCount(0)
})

test('idle: "Stay signed in" keeps the session and records activity on the server', async ({
  page,
}) => {
  await page.clock.install()
  const api = await installMockApi(page)
  await submitPassword(page)
  await expectOnSecurityPage(page)

  await page.clock.fastForward('14:10')
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Enter') // focus is on "Stay signed in"
  await expect(page.getByRole('alertdialog')).toBeHidden()
  expect(api.calls).toContain('GET /auth/session')

  await page.clock.fastForward('10:00')
  await expectOnSecurityPage(page)
  expect(api.calls).not.toContain('POST /auth/logout')
})
