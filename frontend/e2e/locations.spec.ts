/** CTO-34: add, edit and remove locations, each with its own address and timezone. Mocked API. */
import { expect, test, type Route } from '@playwright/test'
import { installMockApi, ok, fail } from './mockApi'

test('add a second location, edit it, and see a removal refused while booked', async ({ page }) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true })
  const locations = [
    {
      id: 'loc-1',
      name: 'Main Location',
      addressLine1: '1 Main St',
      city: 'Austin',
      state: 'TX',
      postalCode: '73301',
      phone: null,
      addressLine2: null,
      timezone: 'America/Chicago',
    },
    {
      id: 'loc-online',
      name: 'Online',
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
      phone: null,
      addressLine2: null,
      timezone: 'America/Chicago',
    },
  ]
  const bodies: Record<string, unknown>[] = []
  const handler = async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '')
    const body = (req.postDataJSON?.() ?? {}) as Record<string, unknown>
    if (req.method() === 'GET' && path === '/locations') return ok(route, { locations })
    if (req.method() === 'POST' && path === '/locations') {
      bodies.push(body)
      locations.push({
        id: 'loc-2',
        addressLine2: null,
        phone: null,
        ...(body as object),
      } as (typeof locations)[number])
      return ok(route, { location: locations.at(-1) })
    }
    if (req.method() === 'PATCH' && path === '/locations/loc-2') {
      Object.assign(locations.find((l) => l.id === 'loc-2')!, body)
      return ok(route, { location: locations.find((l) => l.id === 'loc-2') })
    }
    if (req.method() === 'DELETE' && path === '/locations/loc-2')
      return fail(
        route,
        409,
        'conflict',
        '1 upcoming appointment is booked here. Move or cancel it first.'
      )
    return route.fallback()
  }
  await page.route('http://127.0.0.1:3999/api/v1/locations**', handler)

  await page.goto('/dashboard/locations')
  const list = page.getByTestId('location-list')
  await expect(list).toContainText('Main Location')
  await expect(list).not.toContainText('Online') // the synthetic online location isn't a place

  await page.getByRole('button', { name: 'Add location' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('West Office')
  await dialog.getByLabel('State').selectOption('CA')
  await dialog.getByLabel('ZIP').fill('1234')
  await dialog.getByRole('button', { name: 'Save location' }).click()
  await expect(dialog.getByText('Enter a 5-digit ZIP or ZIP+4')).toBeVisible()
  await dialog.getByLabel('ZIP').fill('90401')
  await dialog.getByLabel('Timezone').selectOption('America/Los_Angeles')
  await dialog.getByRole('button', { name: 'Save location' }).click()
  await expect(list).toContainText('West Office')
  expect(bodies[0]).toMatchObject({
    name: 'West Office',
    state: 'CA',
    postalCode: '90401',
    timezone: 'America/Los_Angeles',
  })

  await page.getByRole('button', { name: 'Edit West Office' }).click()
  await page.getByRole('dialog').getByLabel('Name').fill('West Clinic')
  await page.getByRole('dialog').getByRole('button', { name: 'Save location' }).click()
  await expect(list).toContainText('West Clinic')

  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Remove West Clinic' }).click()
  await expect(page.getByText(/upcoming appointment is booked here/)).toBeVisible()
})
