/**
 * CTO-33: "Key changes to approve" on the scribe draft. Rejecting a dose
 * change keeps that line out of what is sent; after "Approve & send" the
 * provider sees what was not stocked and the patient's checkout link (CTO-32).
 * CTO-32: the link opens the MedoFlow-hosted, clinic-branded checkout for the
 * signed-in patient. Mocked API.
 */
import { expect, test } from '@playwright/test'
import { installMockApi, ok, fail } from './mockApi'
import { installRxCartMock, VISIT_ID } from './rxCartMock'

test('reject a dose change, approve the rest, then see not-stocked items and the link', async ({
  page,
}) => {
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  const rx = await installRxCartMock(page)
  await page.goto(`/dashboard/provider/visits/${VISIT_ID}/scribe`)

  const changes = page.getByTestId('key-changes')
  await expect(changes).toContainText('Key changes to approve')
  const mag = page.getByTestId('key-change-l-mag')
  await expect(mag).toContainText('Dose change')
  await expect(mag).toContainText('400 mg → 600 mg')
  await mag.getByRole('button', { name: 'Reject' }).click()
  await expect(mag.getByRole('button', { name: 'Reject' })).toHaveAttribute('aria-pressed', 'true')

  const panel = page.getByRole('region', { name: 'Detected products' })
  await panel.getByLabel('I confirm these products for this patient').check()
  await page.getByRole('button', { name: 'Approve & send' }).click()
  await expect.poll(() => rx.approveBodies.length).toBe(1)
  const sentIds = (rx.approveBodies[0]!.rxConfirmation as { confirmedLineIds: string[] })
    .confirmedLineIds
  expect(sentIds).not.toContain('l-mag') // rejected: never sent
  expect(sentIds).toContain('l-tram')

  const result = page.getByTestId('send-result')
  await expect(result).toContainText('Not stocked: alternative or external')
  await expect(result).toContainText('Arnica Gel (out of stock)')
  await expect(page.getByTestId('checkout-link')).toContainText('/c/synthetic-clinic/cart?t=')
})

test('the patient opens the link and lands on the clinic-branded checkout', async ({ page }) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const token = 'b'.repeat(64)
  let opened: unknown = null
  await page.route('http://127.0.0.1:3999/api/v1/checkout-links/open', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback()
    opened = route.request().postDataJSON()
    return ok(route, {
      clinicId: 'clinic-e2e',
      clinicSlug: 'synthetic-clinic',
      clinicName: 'Synthetic Clinic',
    })
  })
  await page.goto(`/c/synthetic-clinic/cart?t=${token}`)
  await expect(page).toHaveURL(/\/checkout\?clinic=synthetic-clinic$/)
  expect(opened).toEqual({ token })
})

test("an expired or someone else's link says so", async ({ page }) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  await page.route('http://127.0.0.1:3999/api/v1/checkout-links/open', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fallback()
      : fail(route, 404, 'not_found', 'This checkout link is not valid')
  )
  await page.goto(`/c/synthetic-clinic/cart?t=${'c'.repeat(64)}`)
  await expect(page.getByText(/expired or belongs to another account/)).toBeVisible()
})

test('signed out: sign in first, then back to the link', async ({ page }) => {
  await installMockApi(page)
  await page.goto(`/c/synthetic-clinic/cart?t=${'d'.repeat(64)}`)
  await expect(page).toHaveURL(/auth=login/)
  expect(decodeURIComponent(page.url())).toContain('/c/synthetic-clinic/cart?t=')
})
