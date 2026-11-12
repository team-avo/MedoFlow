/**
 * CTO-07: "Show password" on every password field: sign-up, set password and
 * the sign-in modal. Keyboard reachable, labelled, no serious axe violations.
 */
import { expect, test } from '@playwright/test'
import { installMockApi } from './mockApi'
import { expectNoSeriousA11yViolations } from './helpers'

test('sign-up: the eye button shows and hides the password (keyboard, axe)', async ({ page }) => {
  await installMockApi(page)
  await page.goto('/get-started?plan=GROWTH')
  const input = page.locator('#password')
  await input.fill('Synthetic-Pass-2026!')
  await expect(input).toHaveAttribute('type', 'password')
  await input.focus()
  await page.keyboard.press('Tab')
  const toggle = page.getByRole('button', { name: 'Show password' })
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(input).toHaveAttribute('type', 'text')
  await expect(input).toHaveValue('Synthetic-Pass-2026!')
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  // The field and its button (the page's hero animates, so scan just this region).
  await expectNoSeriousA11yViolations(page, 'div:has(> #password)')
})

test('set password: both fields have the toggle', async ({ page }) => {
  await installMockApi(page)
  await page.goto('/set-password?token=synthetic')
  await expect(page.getByRole('button', { name: 'Show password' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Show password' }).first().click()
  await expect(page.locator('#password')).toHaveAttribute('type', 'text')
  await expect(page.locator('#confirmPassword')).toHaveAttribute('type', 'password')
})

test('sign-in modal: the password has the toggle', async ({ page }) => {
  await installMockApi(page)
  await page.goto('/?auth=login')
  const pw = page.locator('#login-password')
  await expect(pw).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Show password' }).click()
  await expect(pw).toHaveAttribute('type', 'text')
})
