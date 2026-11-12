/**
 * CTO-24: the owner (often the doctor) books an appointment from the
 * dashboard: a new walk-in patient (no password, invite link shown to copy),
 * "Walk-in, now", WALK_IN recorded, "collect at desk" on a prepay service.
 * A taken time answers 409 with a clear message. Mocked API.
 */
import { expect, test, type Page, type Route } from '@playwright/test'
import { installMockApi, ok, fail } from './mockApi'

const API = 'http://127.0.0.1:3999/api/v1'

interface Booked {
  body: Record<string, unknown>
}

async function mockBooking(page: Page, opts: { clash?: boolean } = {}) {
  const booked: Booked[] = []
  const patients: Booked[] = []
  const now = new Date()
  const inAnHour = new Date(now.getTime() + 60 * 60_000)
  inAnHour.setSeconds(0, 0)
  const handler = async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const url = new URL(req.url())
    const key = `${req.method()} ${url.pathname.replace(/^\/api\/v1/, '')}`
    const body = (req.postDataJSON?.() ?? {}) as Record<string, unknown>
    switch (key) {
      case 'GET /services':
        return ok(route, {
          services: [
            {
              id: 'svc-1',
              name: 'Longevity consult',
              duration: 30,
              defaultPrice: '150',
              requirePrepayment: true,
            },
          ],
        })
      case 'GET /providers':
        return ok(route, {
          providers: [
            {
              id: 'prov-1',
              firstName: 'Olivia',
              lastName: 'Owner',
              locationAssignments: [
                { locationId: 'loc-1', location: { id: 'loc-1', name: 'Main' } },
              ],
              providerServices: [{ serviceId: 'svc-1' }],
            },
          ],
        })
      case 'GET /locations':
        return ok(route, { locations: [{ id: 'loc-1', name: 'Main', timezone: 'UTC' }] })
      case 'GET /patients':
        return ok(route, {
          patients: [{ id: 'pat-1', name: 'Existing Patient', email: 'e@example.test' }],
        })
      case 'POST /patients':
        patients.push({ body })
        return ok(route, {
          patient: {
            id: 'pat-new',
            name: body.name,
            email: body.email ?? null,
            phone: body.phone ?? null,
          },
          created: true,
          inviteLink: 'http://127.0.0.1:4310/set-password?token=abc123',
          inviteEmailed: false,
        })
      case 'GET /appointments/availability':
        return ok(route, {
          slots: [
            {
              providerId: 'prov-1',
              locationId: 'loc-1',
              serviceId: 'svc-1',
              timezone: 'UTC',
              start: inAnHour.toISOString(),
              end: new Date(inAnHour.getTime() + 30 * 60_000).toISOString(),
            },
          ],
        })
      case 'POST /appointments':
        booked.push({ body })
        if (opts.clash) return fail(route, 409, 'conflict', 'That time was just taken.')
        return ok(route, { appointment: { id: 'appt-1', status: 'CONFIRMED' } })
      default:
        return route.fallback()
    }
  }
  for (const path of [
    '/services**',
    '/providers**',
    '/locations**',
    '/patients**',
    '/appointments**',
  ]) {
    await page.route(`${API}${path}`, handler)
  }
  return { booked, patients }
}

test('the owner books a new walk-in patient now, collecting at the desk', async ({ page }) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true })
  const calls = await mockBooking(page)
  await page.goto('/dashboard/appointments')
  await page.getByRole('button', { name: 'New appointment' }).click()
  const dialog = page.getByRole('dialog')

  await dialog.getByRole('button', { name: 'New patient' }).click()
  await dialog.getByLabel('Patient name').fill('Wanda Walkin')
  await dialog.getByLabel('Patient email').fill('wanda@example.test')
  await dialog.getByLabel('Service').selectOption('svc-1')
  await dialog.getByLabel('Clinician').selectOption('prov-1')
  await dialog.getByRole('button', { name: 'Walk-in, now' }).click()
  await expect(dialog.getByTestId('chosen-time')).toBeVisible()
  await expect(dialog.getByLabel(/Collect payment at the desk/)).toBeChecked()
  await dialog.getByRole('button', { name: 'Book appointment' }).click()

  // The invite link is shown for copying (works without SMTP).
  await expect(dialog.getByTestId('invite-link')).toBeVisible()
  await expect(dialog.getByLabel('Patient invite link')).toHaveValue(/set-password\?token=/)
  expect(calls.patients[0]!.body).toMatchObject({
    name: 'Wanda Walkin',
    email: 'wanda@example.test',
    sendInvite: true,
  })
  expect(calls.booked[0]!.body).toMatchObject({
    patientId: 'pat-new',
    providerId: 'prov-1',
    serviceId: 'svc-1',
    bookingSource: 'WALK_IN',
    collectAtDesk: true,
  })
})

test('a phone booking for an existing patient; a taken time shows a clear message', async ({
  page,
}) => {
  await installMockApi(page, { role: 'FRONT_DESK', signedIn: true })
  const calls = await mockBooking(page, { clash: true })
  await page.goto('/dashboard/appointments')
  await page.getByRole('button', { name: 'New appointment' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Patient', { exact: true }).selectOption('pat-1')
  await dialog.getByLabel('Service').selectOption('svc-1')
  await dialog.getByLabel('Clinician').selectOption('prov-1')
  await dialog.locator('button[aria-pressed]').first().click()
  await dialog.getByLabel('Phone').check()
  await dialog.getByRole('button', { name: 'Book appointment' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect(calls.booked[0]!.body).toMatchObject({ patientId: 'pat-1', bookingSource: 'PHONE' })
})

test('providers do not get a New appointment button', async ({ page }) => {
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  await page.goto('/dashboard/appointments')
  await expect(page.getByRole('heading', { name: 'Appointments', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New appointment' })).toHaveCount(0)
})
