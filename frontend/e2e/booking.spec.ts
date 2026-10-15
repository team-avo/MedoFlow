/**
 * F1.1 — deposit / slot-hold booking flow:
 *  - pick → hold → prepay → confirm succeeds end to end;
 *  - a hold that expired (or a slot taken) at confirm time shows a clear
 *    "slot taken" recovery on the time picker — not an error — and the
 *    patient books another time;
 *  - a slot taken between listing and holding recovers the same way;
 *  - an expired prepay reservation offers "Pick a new time".
 * No URL carries patient details (F1.3 check runs on every flow).
 */
import { expect, test, type Page } from '@playwright/test'
import { installMockApi } from './mockApi'
import {
  CLINIC_ID,
  SERVICES,
  expectNoPhiInUrls,
  installSchedulingMock,
  utcAt,
} from './schedulingMock'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

const today = () => new Date().toISOString().slice(0, 10)

async function openBooking(page: Page, serviceId: string) {
  await page.goto(`/book/${serviceId}?clinicId=${CLINIC_ID}&providerId=prov-1`)
  await page.getByRole('button', { name: /Avery Lane/ }).click()
  await expect(page.getByRole('heading', { name: 'Select a Date' })).toBeVisible()
}

/** Click a time once to select it, then its Confirm button to place the hold. */
async function holdTime(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
}

test('F1.1 pick → hold → prepay → confirm', async ({ page }) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const api = await installSchedulingMock(page)

  await openBooking(page, SERVICES.prepaid.id)
  await holdTime(page, '9:00 AM')

  // Review states the clinic's cancellation policy before booking: a visit
  // today is already inside the 24-hour window, so the fee is called out.
  await expect(page.getByRole('heading', { name: 'Review & Confirm' })).toBeVisible()
  await expect(page.getByTestId('booking-policy')).toContainText(
    'inside the cancellation window — cancelling now incurs a $25.00 fee'
  )
  await page.getByRole('button', { name: /Confirm visit/ }).click()

  // Prepay: the reservation countdown, then confirm payment.
  await expect(page).toHaveURL(/\/payment\/appt-\d+$/)
  await expect(page.getByRole('heading', { name: 'Complete your booking' })).toBeVisible()
  await expect(page.getByText('Time remaining to confirm')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm & Proceed' }).click()

  await expect(page).toHaveURL(/\/intake\/appt-\d+$/)
  const booked = api.appointments.find((a) => a.patientId !== 'someone-else')!
  expect(booked).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' })
  expect(booked.startTime).toBe(`${today()}T09:00:00.000Z`)
  expect(api.calls).toEqual(
    expect.arrayContaining([
      'POST /public/slots/hold',
      'POST /appointments',
      `POST /payments/${booked.id}/confirm`,
    ])
  )
  expectNoPhiInUrls(api)
})

test('F1.1 an expired hold at confirm → "slot taken" recovery, then books another time', async ({
  page,
}) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const api = await installSchedulingMock(page)

  await openBooking(page, SERVICES.consult.id)
  await holdTime(page, '9:30 AM')
  await expect(page.getByRole('heading', { name: 'Review & Confirm' })).toBeVisible()

  api.failNextBooking = 'expired_hold'
  await page.getByRole('button', { name: /Confirm visit/ }).click()

  // Back on the time picker with a calm notice — no error toast, no dead end.
  const notice = page.getByTestId('slot-taken-notice')
  await expect(notice).toBeVisible()
  await expect(notice).toHaveAttribute('role', 'status')
  await expect(notice).toContainText('That time was just taken')
  await expect(page.getByText('Booking failed')).toHaveCount(0)
  // The lost time is gone from the refreshed list; others remain.
  await expect(page.getByRole('button', { name: '9:30 AM', exact: true })).toHaveCount(0)

  await holdTime(page, '10:00 AM')
  await page.getByRole('button', { name: /Confirm visit/ }).click()
  await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible()
  expect(
    api.appointments.filter((a) => a.patientId !== 'someone-else').map((a) => a.startTime)
  ).toEqual([`${today()}T10:00:00.000Z`])
  expectNoPhiInUrls(api)
})

test('F1.1 a slot taken between listing and holding recovers the same way', async ({ page }) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const api = await installSchedulingMock(page)
  api.stealOnHold.add(`${today()}T09:00:00.000Z`)

  await openBooking(page, SERVICES.consult.id)
  await holdTime(page, '9:00 AM')

  await expect(page.getByTestId('slot-taken-notice')).toBeVisible()
  await expect(page.getByRole('button', { name: '9:00 AM', exact: true })).toHaveCount(0)
  await holdTime(page, '9:30 AM')
  await expect(page.getByRole('heading', { name: 'Review & Confirm' })).toBeVisible()
  expectNoPhiInUrls(api)
})

test('F1.1 an expired prepay reservation offers "Pick a new time"', async ({ page }) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const api = await installSchedulingMock(page, {
    appointments: [
      {
        id: 'appt-expired',
        serviceId: SERVICES.prepaid.id,
        startTime: utcAt(2, '09:00').toISOString(),
        status: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
        bookingHoldExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
  })

  await page.goto('/payment/appt-expired')
  const expired = page.getByTestId('hold-expired')
  await expect(expired).toContainText('Your reservation expired')
  await expect(page.getByRole('button', { name: 'Confirm & Proceed' })).toBeDisabled()
  await expired.getByRole('link', { name: 'Pick a new time' }).click()
  await expect(page).toHaveURL(new RegExp(`/book/${SERVICES.prepaid.id}\\?clinicId=${CLINIC_ID}$`))
  expectNoPhiInUrls(api)
})
