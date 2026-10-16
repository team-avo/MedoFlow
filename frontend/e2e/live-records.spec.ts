/**
 * Component 3 — LIVE front-end ↔ back-end check (no mocks). Opt-in: runs
 * only when E2E_LIVE_API is set, against a real backend (local presigned-URL
 * driver, real Postgres with RLS + field encryption) and a frontend built
 * with NEXT_PUBLIC_API_URL pointing at it. Synthetic data from
 * backend/scripts/seed-e2e-live.ts. See the Component 3 walkthrough §4.
 *
 *   E2E_LIVE_API=http://127.0.0.1:4302 E2E_LIVE_SEED='<seed json>' \
 *   E2E_LIVE_PASSWORD=<password used for the seed> E2E_EXTERNAL_SERVER=1 \
 *   pnpm exec playwright test e2e/live-records.spec.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { PNG_BYTES } from './filesMock'

const LIVE = process.env.E2E_LIVE_API
const seed = LIVE
  ? (JSON.parse(process.env.E2E_LIVE_SEED ?? '{}') as {
      appointmentId: string
      patientId: string
      disciplineId: string
      emails: { admin: string; provider: string; patient: string }
    })
  : null
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? ''
const PHI_FILE = 'Quinn-Marlowe-lab-results.png'

test.describe.configure({ mode: 'serial' })
test.skip(!LIVE, 'live check: set E2E_LIVE_API (see the Component 3 walkthrough)')
test.use({ timezoneId: 'UTC', locale: 'en-US' })

async function signIn(page: Page, email: string, returnUrl: string) {
  await page.goto(`/?auth=login&returnUrl=${encodeURIComponent(returnUrl)}`)
  await page.getByLabel(/email/i).first().fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(returnUrl.replace(/[/]/g, '\\/')))
}

function watchUrls(page: Page) {
  const urls: string[] = []
  const blobHeaders: Record<string, string>[] = []
  page.on('request', (r) => {
    urls.push(r.url())
    if (r.url().includes('/files/blob/')) blobHeaders.push(r.headers())
  })
  return { urls, blobHeaders }
}

const expectNoFilenameInUrls = (urls: string[]) => {
  const leaks = urls.filter((u) => /quinn|marlowe|lab-results/i.test(decodeURIComponent(u)))
  expect(leaks).toEqual([])
}

test('provider: SOAP note, file upload/download/preview, prescription, plan — against the real API', async ({
  page,
}) => {
  const seen = watchUrls(page)
  await signIn(
    page,
    seed!.emails.provider,
    `/dashboard/provider/appointments/${seed!.appointmentId}`
  )

  // SOAP note (stored encrypted, read back as plaintext).
  await page.getByRole('button', { name: 'Start manual note' }).click()
  await page.locator('#manual-note-subjective').fill('Synthetic live S: knee pain two weeks')
  await page.locator('#manual-note-plan').fill('Synthetic live P: physiotherapy')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.getByRole('button', { name: 'Close' }).last().click()
  await expect(page.getByText('Synthetic live S: knee pain two weeks').first()).toBeVisible()

  // Files: presigned upload → list → download → preview.
  await page.getByRole('button', { name: 'Full Clinical Record' }).click()
  await page.getByRole('tab', { name: /Files/ }).click()
  await page.getByLabel('Upload file').setInputFiles({
    name: PHI_FILE,
    mimeType: 'image/png',
    buffer: PNG_BYTES,
  })
  await expect(page.getByText('File uploaded')).toBeVisible()
  await expect(page.getByText(PHI_FILE)).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe(PHI_FILE)
  await page.getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByRole('img', { name: 'File preview' })).toHaveAttribute('src', /^blob:/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'File preview' })).toHaveCount(0)

  // A disallowed type is refused client-side.
  await page.getByLabel('Upload file').setInputFiles({
    name: 'x.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  })
  await expect(page.getByText('This file type is not allowed', { exact: false })).toBeVisible()
  await page.keyboard.press('Escape')

  // Prescription: blank is blocked client-side; a valid one is saved.
  await page.goto(`/dashboard/provider/appointments/${seed!.appointmentId}`)
  await page.getByRole('button', { name: 'Add New' }).click()
  await page.getByRole('button', { name: 'Save Prescription' }).click()
  await expect(page.getByText('Prescription notes are required')).toBeVisible()
  await page.getByLabel('Prescription').fill('Synthetic live Rx: vitamin D 1000 IU daily')
  await page.getByRole('button', { name: 'Save Prescription' }).click()
  await expect(page.getByText('Prescription added')).toBeVisible()
  await expect(page.getByText('Synthetic live Rx: vitamin D 1000 IU daily')).toBeVisible()

  // Treatment plan: invalid blocked, valid created.
  await page.goto(`/dashboard/provider/patients/${seed!.patientId}/plans`)
  await page.getByRole('button', { name: 'New Protocol' }).click()
  // (The number input's native min=1 also blocks 0; an empty name exercises the Zod rule.)
  await page.getByRole('button', { name: 'Create Plan' }).click()
  await expect(page.getByText('Plan name is required')).toBeVisible()
  await page.locator('input[name="name"]').fill('Synthetic live knee plan')
  await page.locator('select[name="disciplineId"]').selectOption(seed!.disciplineId)
  await page.locator('input[name="totalSessions"]').fill('6')
  await page.getByRole('button', { name: 'Create Plan' }).click()
  await expect(page.getByText('Synthetic live knee plan')).toBeVisible()

  // Every byte went through /files/blob/ presigned URLs with no credentials.
  expect(seen.blobHeaders.length).toBeGreaterThanOrEqual(3)
  for (const h of seen.blobHeaders) {
    expect(h['authorization']).toBeUndefined()
    expect(h['cookie']).toBeUndefined()
  }
  expectNoFilenameInUrls(seen.urls)
})

test('patient: downloads their own file and submits the intake form — against the real API', async ({
  page,
}) => {
  const seen = watchUrls(page)
  await signIn(page, seed!.emails.patient, `/account/appointments/${seed!.appointmentId}`)
  await expect(page.getByText(PHI_FILE)).toBeVisible()
  await expect(page.getByLabel('Upload file')).toHaveCount(0)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  expect((await download).suggestedFilename()).toBe(PHI_FILE)

  await page.goto(`/intake/${seed!.appointmentId}`)
  await page.getByRole('button', { name: /submit/i }).click()
  await expect(page.getByText('Required').first()).toBeVisible()
  await page.getByLabel(/Reason for visit/).fill('Synthetic live intake: knee pain')
  await page.getByLabel(/I consent to treatment/).check()
  await page.getByRole('button', { name: /submit/i }).click()
  await expect(page.getByRole('button', { name: /submit/i })).toHaveCount(0)
  expectNoFilenameInUrls(seen.urls)
})
