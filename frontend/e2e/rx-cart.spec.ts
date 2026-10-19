/**
 * Component 5 — Prescription → Cart in the browser.
 *  F5.1 the scribe screen shows detected products as removable chips the
 *       provider confirms before "Approve & send"; exactly the confirmed
 *       items are sent
 *  F5.2 the patient cart shows "Prescribed · Dr. X", accept / decline, and a
 *       one-click "Pay with card on file" completes (a decline is recoverable)
 *  F5.3 card + shipping "on file from booking"; no re-entry fields for a
 *       returning patient; without a card it falls back to normal checkout
 */
import { expect, test } from '@playwright/test'
import { installMockApi } from './mockApi'
import { expectNoSeriousA11yViolations } from './helpers'
import { installRxCartMock, expectNoPhiInUrls, SESSION_ID, VISIT_ID } from './rxCartMock'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

test('F5.1 provider removes, maps and confirms detected products, then "Approve & send"', async ({
  page,
}) => {
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  const rx = await installRxCartMock(page)

  await page.goto(`/dashboard/provider/visits/${VISIT_ID}/scribe`)
  const panel = page.getByRole('region', { name: 'Detected products' })
  await expect(panel.getByText('Magnesium Glycinate × 2')).toBeVisible()
  await expect(panel.getByText('Arnica Gel × 1')).toBeVisible()
  await expect(panel.getByText('Tramadol × 1')).toBeVisible()
  await expect(panel.getByText('e-Prescribe', { exact: true })).toBeVisible()
  // The unmapped order is surfaced, never dropped.
  await expect(panel.getByText('Turmeric complex × 1')).toBeVisible()

  // Nothing can be sent before the provider confirms.
  const send = page.getByRole('button', { name: 'Approve & send' })
  await expect(send).toBeDisabled()
  await expect(page.getByText('Confirm the detected products before sending')).toBeVisible()

  await panel.getByRole('button', { name: 'Remove Arnica Gel' }).click()
  await expect(panel.getByRole('button', { name: 'Restore Arnica Gel' })).toBeVisible()
  await panel.getByLabel('Map Turmeric complex to a product').selectOption('p-turm')
  await expect(panel.getByText('Turmeric Curcumin × 1')).toBeVisible()
  await expect(panel.getByTestId('rx-send-summary')).toContainText(
    "2 to the patient's cart, 1 to e-prescribe"
  )
  await expectNoSeriousA11yViolations(page, 'section[aria-label="Detected products"]')

  await panel.getByLabel('I confirm these products for this patient').check()
  await expect(send).toBeEnabled()
  await send.click()

  await expect.poll(() => rx.approveBodies.length).toBe(1)
  // Exactly what the provider left on screen — the removed chip is not sent.
  expect(rx.approveBodies[0]).toEqual({
    rxConfirmation: {
      proposalId: 'proposal-e2e-1',
      confirmedLineIds: ['l-mag', 'l-tram', 'l-turmeric'],
      acknowledged: true,
    },
  })
  expect(rx.calls).toContain(`PUT /ai-scribe/session/${SESSION_ID}/draft`)
  await expect(page.getByText(/2 products sent to the patient's cart/)).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Products sent' })
      .getByText("Sent: 2 to the patient's cart, 1 to e-prescribe")
  ).toBeVisible()
  expectNoPhiInUrls(rx)
})

test('F5.2 / F5.3 patient accepts / declines prescribed items and pays with the card on file', async ({
  page,
}) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const rx = await installRxCartMock(page)

  await page.goto('/checkout')
  await expect(page.getByText('Prescribed · Dr. Avery Stone')).toHaveCount(2)

  // F5.3: card and shipping on file from booking — nothing to re-enter.
  const oneClick = page.getByTestId('one-click-pay')
  await expect(oneClick.getByText('Visa •••• 4242')).toBeVisible()
  await expect(oneClick.getByText(/100 Example Street/)).toBeVisible()
  await expect(oneClick.getByText('On file from booking')).toHaveCount(2)
  // No address or card fields anywhere (the footer newsletter box is unrelated).
  await expect(
    page.getByRole('textbox', { name: /address|street|city|postal|card|cvc|expir/i })
  ).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)

  // Prescribed items need the patient's decision first.
  const pay = page.getByRole('button', { name: /with card on file/ })
  await expect(pay).toBeDisabled()
  await page.getByRole('button', { name: 'Accept Magnesium Glycinate' }).click()
  await page.getByRole('button', { name: 'Decline Arnica Gel' }).click()
  await expect(page.getByText('Declined — not charged')).toBeVisible()
  await expect(pay).toHaveText('Pay $48.00 with card on file')
  await expect(pay).toBeEnabled()
  await expectNoSeriousA11yViolations(page, '[data-testid="one-click-pay"]')

  // A declined card is a recoverable state.
  rx.oneClick = 'decline'
  await pay.click()
  await expect(page.getByRole('alert').filter({ hasText: 'Your card was declined' })).toBeVisible()
  await expect(pay).toBeEnabled()

  // One action completes the purchase.
  rx.oneClick = 'succeed'
  await pay.click()
  await expect(page.getByRole('heading', { name: "You're all set!" })).toBeVisible()
  await expect(page.getByText('Qty 2 × $24.00')).toBeVisible()
  expect(rx.oneClickCalls).toBe(2)
  expect(rx.calls).toEqual(
    expect.arrayContaining(['PATCH /carts/items/ci-1/decision', 'PATCH /carts/items/ci-2/decision'])
  )
  expectNoPhiInUrls(rx)
})

test('F5.2 without a card on file the cart falls back to the regular checkout', async ({
  page,
}) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const rx = await installRxCartMock(page, {
    onFile: { eligible: false, reason: 'NO_CARD_ON_FILE', card: null, shippingAddress: null },
  })

  await page.goto('/checkout')
  await expect(page.getByText('Prescribed · Dr. Avery Stone')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Secure Checkout' })).toBeVisible()
  await expect(page.getByRole('button', { name: /with card on file/ })).toHaveCount(0)
  expect(rx.oneClickCalls).toBe(0)
})
