/**
 * F1.2 — waitlist + recurring UI:
 *  - a patient joins the waitlist for a clinician from a fully booked date;
 *  - a front-desk user books a weekly recurring series (one week conflicts:
 *    reviewed and kept as a partial series), then cancels the whole series.
 */
import { expect, test } from '@playwright/test'
import { installMockApi } from './mockApi'
import { expectNoSeriousA11yViolations } from './helpers'
import {
  CLINIC_ID,
  PATIENT,
  SERVICES,
  expectNoPhiInUrls,
  installSchedulingMock,
} from './schedulingMock'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

test('F1.2 a patient joins the waitlist from a fully booked date', async ({ page }) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const api = await installSchedulingMock(page)
  api.fullyBooked = true

  await page.goto(`/book/${SERVICES.consult.id}?clinicId=${CLINIC_ID}&providerId=prov-1`)
  await page.getByRole('button', { name: /Avery Lane/ }).click()
  await expect(page.getByText('No availability')).toBeVisible()
  await page.getByRole('button', { name: 'Join the waitlist' }).click()

  const dialog = page.getByRole('dialog', { name: 'Join waitlist' })
  await expect(dialog).toBeVisible()
  await expectNoSeriousA11yViolations(page, '[role="dialog"]')
  await dialog.getByLabel('Preferred start time').fill('08:00')
  await dialog.getByLabel('Preferred end time').fill('12:00')
  await dialog.getByRole('button', { name: 'Join waitlist' }).click()

  await expect(page.getByText("You're on the waitlist")).toBeVisible()
  await expect(dialog).toHaveCount(0)
  expect(api.waitlist).toHaveLength(1)
  expect(api.waitlist[0]).toMatchObject({
    clinicId: CLINIC_ID,
    providerId: 'prov-1',
    serviceId: SERVICES.consult.id,
    preferredDate: new Date().toISOString().slice(0, 10),
    preferredStartTime: '08:00',
    preferredEndTime: '12:00',
  })
  expectNoPhiInUrls(api)
})

test('F1.2 front desk books a weekly recurring series, then cancels it', async ({ page }) => {
  await installMockApi(page, { role: 'FRONT_DESK', signedIn: true })
  const api = await installSchedulingMock(page)
  api.seriesConflictWeeks = [2]

  await page.goto('/dashboard/appointments')
  await page.getByRole('button', { name: 'New recurring series' }).click()

  const dialog = page.getByRole('dialog', { name: 'New recurring series' })
  await dialog.getByLabel('Patient').selectOption({ label: PATIENT.name })
  await dialog.getByLabel('Service').selectOption({ label: SERVICES.consult.name })
  await dialog.getByLabel('Clinician').selectOption({ label: 'Avery Lane' })
  // First visit a week out, so every visit in the series is upcoming.
  const firstVisit = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  await dialog.getByLabel('First visit').fill(firstVisit)
  await dialog.getByLabel('Weekly visits').fill('4')
  await dialog.getByRole('button', { name: '10:00 AM', exact: true }).click()
  await expectNoSeriousA11yViolations(page, '[role="dialog"]')
  await dialog.getByRole('button', { name: 'Book series' }).click()

  // One week could not be booked: reviewed, partial series kept.
  const conflicts = page.getByRole('dialog', { name: 'Some dates could not be booked' })
  await expect(conflicts).toContainText('3 appointments were created')
  await conflicts.getByRole('button', { name: 'Proceed with 3 bookings' }).click()
  await expect(page.getByText('Recurring series booked — 3 weekly visits')).toBeVisible()

  const created = api.appointments.filter((a) => a.recurringSeriesId)
  expect(created).toHaveLength(3)
  expect(created[0]!.startTime).toBe(`${firstVisit}T10:00:00.000Z`)
  expect(new Set(created.map((a) => a.recurringSeriesId)).size).toBe(1)
  // The registry renders a table and (hidden) mobile cards; count what is shown.
  await expect(page.getByText('Weekly series').filter({ visible: true })).toHaveCount(3)

  // Cancel the whole series from any of its rows.
  await page
    .getByRole('button', { name: 'Cancel series' })
    .filter({ visible: true })
    .first()
    .click()
  const confirm = page.getByRole('alertdialog', { name: 'Cancel the whole series?' })
  await confirm.getByRole('button', { name: 'Cancel series' }).click()
  await expect(page.getByText('Series cancelled — 3 upcoming visits cancelled')).toBeVisible()
  expect(api.appointments.filter((a) => a.recurringSeriesId).map((a) => a.status)).toEqual([
    'CANCELLED',
    'CANCELLED',
    'CANCELLED',
  ])
  expect(api.calls).toContain(
    `POST /appointments/recurring/${created[0]!.recurringSeriesId}/cancel`
  )
  expectNoPhiInUrls(api)
})
