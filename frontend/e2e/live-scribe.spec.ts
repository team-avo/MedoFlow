/**
 * Component 2 — LIVE front-end ↔ back-end run of the AI scribe (no mocks in
 * the browser). Opt-in: runs only when E2E_LIVE_API is set, against a real
 * backend (Postgres with RLS + field encryption, Redis + the BullMQ worker)
 * whose AI is `AI_SCRIBE_*_PROVIDER=mock` — or any real provider — and a
 * frontend built with NEXT_PUBLIC_API_URL pointing at it. Synthetic data from
 * backend/scripts/seed-e2e-live.ts. See the Component 2 walkthrough §4.
 *
 *   E2E_LIVE_API=http://127.0.0.1:4302 E2E_LIVE_SEED='<seed json>' \
 *   E2E_LIVE_PASSWORD=<password used for the seed> E2E_EXTERNAL_SERVER=1 \
 *   pnpm exec playwright test e2e/live-scribe.spec.ts
 *
 * The recording is a synthetic audio file uploaded through the console's
 * "Upload a recording" (a browser cannot be given a microphone here); the
 * real pipeline runs: consent → upload → queue → worker (transcribe, label,
 * draft) → review → "Approve & send" → the patient's portal.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.E2E_LIVE_API
const seed = LIVE
  ? (JSON.parse(process.env.E2E_LIVE_SEED ?? '{}') as {
      scribeVisitRecordId: string
      emails: { provider: string; patient: string }
    })
  : null
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? ''

test.describe.configure({ mode: 'serial' })
test.skip(!LIVE, 'live check: set E2E_LIVE_API (see the Component 2 walkthrough)')
test.use({ timezoneId: 'UTC', locale: 'en-US' })

async function signIn(page: Page, email: string, returnUrl: string) {
  await page.goto(`/?auth=login&returnUrl=${encodeURIComponent(returnUrl)}`)
  await page.getByLabel(/email/i).first().fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(returnUrl.replace(/[/]/g, '\\/')))
}

const urls: string[] = []
const expectNoPhiInUrls = () => {
  const leaks = urls.filter((u) =>
    /quinn|marlowe|fatigue|vitamin|magnesium|tired/i.test(decodeURIComponent(u))
  )
  expect(leaks).toEqual([])
}

// A tiny synthetic "recording" (WebM magic bytes + padding). The mock STT
// ignores the content; a real provider would transcribe silence.
const RECORDING = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4096, 7)])

test('provider: consent → upload → AI draft → review → "Approve & send"', async ({ page }) => {
  test.setTimeout(180_000)
  page.on('request', (r) => urls.push(r.url()))
  const console = `/dashboard/provider/visits/${seed!.scribeVisitRecordId}/scribe`
  await signIn(page, seed!.emails.provider, console)

  await page.getByRole('button', { name: 'Start documentation session' }).click()

  // FR-1: booked without consent → nothing can be recorded until it is recorded.
  await expect(page.getByText('Patient consent is needed before recording')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload a recording' })).toBeDisabled()
  await page.getByLabel('The patient gave verbal consent to AI recording for this visit').check()
  await page.getByRole('button', { name: 'Record consent' }).click()
  await expect(page.getByRole('button', { name: 'Upload a recording' })).toBeEnabled()

  await page.getByLabel('Upload a recording').setInputFiles({
    name: 'consultation.webm',
    mimeType: 'audio/webm',
    buffer: RECORDING,
  })

  // The worker transcribes, labels speakers and drafts.
  const review = page.getByRole('region', { name: 'Review AI draft' })
  await expect(review).toBeVisible({ timeout: 120_000 })
  await expect(review.getByTestId('scribe-provenance')).toContainText('Drafted by')
  await expect(page.getByRole('region', { name: 'Transcript' })).toContainText('Provider:')
  await expect(review.getByLabel('Assessment')).not.toHaveValue('')
  await expect(review.getByLabel('What to do next')).not.toHaveValue('')

  await review.getByLabel('What to do next').fill('Synthetic: book a check-up in six weeks.')
  // The draft also detected products (B2.2, with dose): nothing is sent until
  // the provider confirms them (B5.2).
  const send = review.getByRole('button', { name: 'Approve & send' })
  const products = page.getByRole('region', { name: 'Detected products' })
  await expect(products.getByText(/Magnesium Glycinate · 400 mg × 2/)).toBeVisible()
  await expect(send).toBeDisabled()
  await products.getByLabel('I confirm these products for this patient').check()
  await send.click()
  await expect(page.getByText('Note approved and sent', { exact: true })).toBeVisible()
  expectNoPhiInUrls()
})

test('patient: the approved summary is in the portal — and nothing else from the visit', async ({
  page,
}) => {
  page.on('request', (r) => urls.push(r.url()))
  await signIn(page, seed!.emails.patient, '/account/summaries')
  const list = page.getByRole('list', { name: 'Visit summaries' })
  await expect(list.getByText('Synthetic: book a check-up in six weeks.')).toBeVisible()
  await expect(page.getByText('Provider:')).toHaveCount(0) // no transcript
  expectNoPhiInUrls()
})
