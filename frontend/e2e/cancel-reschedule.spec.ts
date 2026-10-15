/**
 * F1.3 — cancel / reschedule surfaces respect the clinic's policy:
 *  - the policy (free-until time and fee) is stated before acting;
 *  - a patient reschedules (the slot-taken case recovers in place), then
 *    cancels inside the free window;
 *  - inside the window the dialog warns of the fee and the result reports it;
 *  - past or completed visits offer no self-service actions;
 *  - no URL in any of these flows carries patient details.
 */
import { expect, test } from '@playwright/test'
import { installMockApi } from './mockApi'
import { expectNoSeriousA11yViolations } from './helpers'
import { expectNoPhiInUrls, installSchedulingMock, utcAt } from './schedulingMock'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

test('F1.3 reschedule (with a slot-taken retry), then cancel free of charge', async ({ page }) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const start = utcAt(3, '09:00')
  const api = await installSchedulingMock(page, {
    appointments: [{ id: 'appt-1', startTime: start.toISOString() }],
  })

  await page.goto('/account/appointments/appt-1')
  await expect(page.getByTestId('appointment-policy')).toContainText('Free cancellation until')
  await expect(page.getByTestId('appointment-policy')).toContainText('a $25.00 fee applies')

  // Reschedule: the first pick is taken just before confirming → in-place recovery.
  await page.getByRole('button', { name: 'Reschedule' }).click()
  const dialog = page.getByRole('dialog', { name: 'Reschedule Appointment' })
  await expect(dialog.getByRole('button', { name: '9:30 AM', exact: true })).toBeVisible()
  await expectNoSeriousA11yViolations(page, '[role="dialog"]')
  await dialog.getByRole('button', { name: '9:30 AM', exact: true }).click()
  api.failNextBooking = 'conflict'
  await dialog.getByRole('button', { name: 'Reschedule', exact: true }).click()
  await expect(dialog.getByTestId('slot-taken-notice')).toContainText('That time was just taken')
  await expect(dialog.getByRole('button', { name: '9:30 AM', exact: true })).toHaveCount(0)

  await dialog.getByRole('button', { name: '10:00 AM', exact: true }).click()
  await dialog.getByRole('button', { name: 'Reschedule', exact: true }).click()
  await expect(page.getByText('Appointment rescheduled')).toBeVisible()
  await expect(page).toHaveURL(/\/account\/appointments\/appt-\d+$/)
  const fresh = api.appointments.find((a) => a.id !== 'appt-1' && a.patientId !== 'someone-else')!
  expect(page.url()).toContain(`/account/appointments/${fresh.id}`)
  expect(api.appointments.find((a) => a.id === 'appt-1')!.status).toBe('RESCHEDULED')
  expect(fresh.startTime).toBe(utcAt(3, '10:00').toISOString())

  // Cancel the new one: policy shown in the dialog, free (outside the window).
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  const cancel = page.getByRole('alertdialog', { name: 'Cancel appointment?' })
  await expect(cancel.getByTestId('cancellation-policy')).toContainText('Free cancellation until')
  await expectNoSeriousA11yViolations(page, '[role="alertdialog"]')
  await cancel.getByLabel('Reason (optional)').fill('Schedule changed')
  await cancel.getByRole('button', { name: 'Cancel appointment' }).click()
  await expect(page.getByText('Appointment cancelled', { exact: true })).toBeVisible()
  expect(fresh.status).toBe('CANCELLED')
  // A cancelled visit offers no more actions.
  await expect(page.getByRole('button', { name: 'Reschedule' })).toHaveCount(0)
  expectNoPhiInUrls(api)
})

test('F1.3 inside the cancellation window the fee is stated up front and reported', async ({
  page,
}) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const soon = new Date(Date.now() + 2 * 3_600_000)
  soon.setUTCSeconds(0, 0)
  const api = await installSchedulingMock(page, {
    appointments: [{ id: 'appt-soon', startTime: soon.toISOString() }],
  })

  await page.goto('/account/appointments/appt-soon')
  await expect(page.getByTestId('appointment-policy')).toContainText(
    'inside the cancellation window'
  )
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  const cancel = page.getByRole('alertdialog', { name: 'Cancel appointment?' })
  await expect(cancel.getByTestId('cancellation-policy')).toContainText(
    'cancelling now incurs a $25.00 fee'
  )
  await cancel.getByRole('button', { name: 'Cancel appointment' }).click()
  await expect(page.getByText('A late-cancellation fee of $25.00 applies')).toBeVisible()
  expectNoPhiInUrls(api)
})

test('F1.3 past and completed visits offer no reschedule or cancel', async ({ page }) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const api = await installSchedulingMock(page, {
    appointments: [
      { id: 'appt-done', startTime: utcAt(-2, '09:00').toISOString(), status: 'COMPLETED' },
      { id: 'appt-past', startTime: utcAt(-1, '09:00').toISOString(), status: 'CONFIRMED' },
    ],
  })

  for (const id of ['appt-done', 'appt-past']) {
    await page.goto(`/account/appointments/${id}`)
    await expect(page.getByText('Visit Details')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reschedule' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancel appointment' })).toHaveCount(0)
  }
  expectNoPhiInUrls(api)
})
