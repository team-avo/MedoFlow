/**
 * F0.2.2 — MFA enrol, then sign-in challenge: a valid code succeeds, an
 * invalid one fails; the screens are keyboard accessible (keyboard-only
 * flow + axe scan with no serious/critical violations).
 */
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { installMockApi, totp } from './mockApi'
import { expectOnSecurityPage, submitPassword } from './helpers'

async function expectNoSeriousA11yViolations(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).analyze()
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  )
  const describe = (v: (typeof serious)[number]) =>
    `${v.id}: ${v.help} → ${v.nodes.map((n) => `${n.target.join(' ')} [${n.any.map((c) => c.message).join(' | ')}]`).join('; ')}`
  expect(serious.map(describe)).toEqual([])
}

test('MFA: enrol on the Security page, then sign in with a code (keyboard only)', async ({
  page,
}) => {
  const api = await installMockApi(page)

  // ── Enrol ────────────────────────────────────────────────────────────
  await submitPassword(page)
  await expectOnSecurityPage(page)
  await expect(page.getByTestId('mfa-status')).toHaveText('Off')

  const setup = page.getByRole('button', { name: 'Set up two-step verification' })
  await setup.focus()
  await page.keyboard.press('Enter')
  const secret = (await page.getByTestId('mfa-secret').textContent())!.trim()
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/)
  await expect(page.getByRole('img', { name: 'Authenticator setup QR code' })).toBeVisible()
  await expectNoSeriousA11yViolations(page, '[aria-labelledby="mfa-settings-title"]')

  // A wrong code is refused…
  const codeInput = page.getByLabel('Verification code')
  await expect(codeInput).toBeFocused()
  await page.keyboard.type('000000')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible()
  await expect(codeInput).toHaveAttribute('aria-invalid', 'true')

  // …the authenticator's code turns MFA on and shows recovery codes once.
  await codeInput.focus()
  await page.keyboard.type(totp(secret))
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(8)
  await expect(page.getByTestId('mfa-status')).toHaveText('On')
  await page.getByRole('button', { name: 'I have saved them' }).click()

  // ── Sign out, then sign in again: password → challenge ──────────────
  await page
    .getByRole('button', { name: /Synthetic Front Desk|account menu|user menu/i })
    .first()
    .click()
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).not.toHaveURL(/\/dashboard/)

  await submitPassword(page)
  const challenge = page.getByLabel('Verification code')
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
  await expect(challenge).toBeFocused()
  await expectNoSeriousA11yViolations(page, 'form[aria-labelledby="mfa-heading"]')

  // Invalid code: refused, no session.
  await page.keyboard.type('123456' === totp(secret) ? '654321' : '123456')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'That code is not valid' })).toBeVisible()
  await expect(page).not.toHaveURL(/\/dashboard/)

  // Valid code: signed in and routed to where we were going.
  await page.keyboard.type(totp(secret))
  await page.keyboard.press('Enter')
  await expectOnSecurityPage(page)
  expect(api.calls.filter((c) => c === 'POST /auth/mfa/verify')).toHaveLength(2)
})
