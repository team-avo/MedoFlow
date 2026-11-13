/**
 * Demo feedback WS1: "a logged-in patient is still asked for details on the
 * clinic's own website". The clinic site runs on a different browser site
 * (here everwell.localhost vs the app on 127.0.0.1), so the app's refresh
 * cookie never reaches it; the mock models that per origin (mockApi
 * cookieOrigins). The booking page bounces once through the app host and
 * comes back signed in (lib/authHandoff).
 *
 * Needs the build to know the app origin: NEXT_PUBLIC_APP_URL=http://127.0.0.1:4310
 * (playwright.config.ts sets it for its own build).
 */
import { expect, test } from '@playwright/test'
import { installMockApi } from './mockApi'
import { CLINIC_ID, SERVICES, expectNoPhiInUrls, installSchedulingMock } from './schedulingMock'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

const CLINIC_HOST = 'http://everwell.localhost:4310'
const bookUrl = (serviceId: string) =>
  `${CLINIC_HOST}/book/${serviceId}?clinicId=${CLINIC_ID}&providerId=prov-1`

test('a patient signed in on the app books on the clinic domain without re-entering anything', async ({
  page,
}) => {
  const auth = await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const api = await installSchedulingMock(page)

  await page.goto(bookUrl(SERVICES.consult.id))

  // Back on the clinic host, signed in, with the one-time code gone from the URL.
  await expect(page.getByTestId('booking-account')).toContainText('Signed in as Quinn Marlowe')
  await expect(page).toHaveURL(/^http:\/\/everwell\.localhost:4310\/book\//)
  await expect(page).not.toHaveURL(/[?&]handoff=/)
  expect(auth.calls).toEqual(
    expect.arrayContaining(['POST /auth/handoff/start', 'POST /auth/handoff/exchange'])
  )
  // The clinic origin now holds its own session.
  expect(auth.cookieOrigins.has(CLINIC_HOST)).toBe(true)

  await page.getByRole('button', { name: /Avery Lane/ }).click()
  await page.getByRole('button', { name: '9:00 AM', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review & Confirm' })).toBeVisible()
  await expect(page.getByTestId('your-details')).toContainText('Quinn Marlowe')
  await expect(page.getByTestId('booking-signin-gate')).toHaveCount(0)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.getByRole('button', { name: /Confirm visit/ }).click()
  await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible()
  expectNoPhiInUrls(api)
})

test('a visitor signed in nowhere bounces once and gets the sign-in gate (no loop)', async ({
  page,
}) => {
  const auth = await installMockApi(page, { role: 'PATIENT', signedIn: false })
  await installSchedulingMock(page)

  await page.goto(bookUrl(SERVICES.consult.id))
  await expect(page.getByTestId('booking-account')).toContainText('Sign in')
  await expect(page).toHaveURL(/^http:\/\/everwell\.localhost:4310\/book\//)
  await expect(page).not.toHaveURL(/[?&]handoff=/)

  await page.getByRole('button', { name: /Avery Lane/ }).click()
  await page.getByRole('button', { name: '9:00 AM', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByTestId('booking-signin-gate')).toBeVisible()
  expect(auth.calls.filter((c) => c === 'POST /auth/handoff/start')).toHaveLength(1)
  expect(auth.calls).not.toContain('POST /auth/handoff/exchange')
})
