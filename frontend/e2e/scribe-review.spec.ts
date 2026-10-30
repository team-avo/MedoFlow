/**
 * Component 2 — AI Scribe / EMR in the browser (mocked API).
 *  FR-1   no recording without consent: the provider attests verbal consent;
 *         a patient can decline from their join link
 *  F2.1   one review core: edit note + patient summary, "Approve & send"
 *         sends exactly what is on screen and publishes only the summary
 *  FR-11  a failed run shows a safe reason, Retry and the manual fallback;
 *         an unconfigured server says so instead of failing later
 *  FR-7   continuity and the record over time are shown for review
 *  F2.6   the patient's portal lists published summaries
 *  F0.3.1 no patient detail in any URL
 */
import { expect, test } from '@playwright/test'
import { installMockApi, MOCK_USERS } from './mockApi'
import { expectNoSeriousA11yViolations } from './helpers'
import {
  installScribeMock,
  JOIN_TOKEN,
  SESSION_ID,
  VISIT_ID,
  type ScribeMockState,
} from './scribeMock'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

const expectNoPhiInUrls = (state: ScribeMockState) => {
  const user = MOCK_USERS.PATIENT
  for (const url of state.urls) {
    const decoded = decodeURIComponent(url)
    for (const needle of [user.name, user.email, 'lumbar', 'back strain', 'Magnesium']) {
      expect(decoded, `URL leaks "${needle}": ${url}`).not.toContain(needle)
    }
  }
}

test('provider: consent → demo draft → review → "Approve & send"', async ({ page }) => {
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  const scribe = await installScribeMock(page, { consent: 'PENDING' })

  await page.goto(`/dashboard/provider/visits/${VISIT_ID}/scribe`)

  // FR-1: no recording until consent is recorded.
  await expect(page.getByText('Patient consent is needed before recording')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeDisabled()
  const recordConsent = page.getByRole('button', { name: 'Record consent' })
  await expect(recordConsent).toBeDisabled()
  await page.getByLabel('The patient gave verbal consent to AI recording for this visit').check()
  await recordConsent.click()
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
  expect(scribe.calls).toContain(`POST /ai-scribe/session/${SESSION_ID}/consent`)

  // Demo conversation → the AI draft for review.
  await page.getByRole('button', { name: 'Demo: simulate conversation' }).click()
  const review = page.getByRole('region', { name: 'Review AI draft' })
  await expect(review.getByTestId('scribe-provenance')).toHaveText('Drafted by mock-scribe-1')
  await expect(review.getByLabel('Assessment')).toHaveValue('Synthetic: lumbar strain, improving.')
  await expect(
    review.getByText('Synthetic: since the last visit, stiffness is easing.')
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Transcript' })).toContainText('Still stiff')
  const history = page.getByRole('region', { name: 'Record over time' })
  await expect(history.getByText('Synthetic: acute lumbar strain.')).toBeVisible()
  await expect(history.getByText('Magnesium Glycinate 400 mg × 1')).toBeVisible()

  // The summary is required before sending.
  const send = review.getByRole('button', { name: 'Approve & send' })
  await review.getByLabel('What we found').fill('')
  await review.getByLabel('What we recommended').fill('')
  await review.getByLabel('What to do next').fill('')
  await expect(send).toBeDisabled()
  await expect(review.getByTestId('approve-blocked')).toHaveText(
    'Write the patient summary before sending it'
  )
  await review.getByLabel('What to do next').fill('Synthetic: return in one week.')
  await review.getByLabel('Plan').fill('Synthetic: edited plan.')
  await expectNoSeriousA11yViolations(page, 'section[aria-label="Review AI draft"]')
  await send.click()

  await expect.poll(() => scribe.approveBodies.length).toBe(1)
  expect(scribe.approveBodies[0]).toEqual({
    sendToPatient: true,
    draft: {
      subjective: 'Synthetic: lower back stiffness in the mornings.',
      objective: 'Synthetic: restricted lumbar flexion.',
      assessment: 'Synthetic: lumbar strain, improving.',
      plan: 'Synthetic: edited plan.',
    },
    patientSummary: {
      diagnosis: '',
      treatmentPlan: '',
      nextSteps: 'Synthetic: return in one week.',
    },
  })
  await expect(page.getByText('Note approved and sent')).toBeVisible()
  await expect(review.getByLabel('Assessment')).toBeDisabled()
  expectNoPhiInUrls(scribe)
})

test('provider: a failed run explains why and offers Retry and a manual note', async ({ page }) => {
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  const scribe = await installScribeMock(page, { status: 'FAILED' })

  await page.goto(`/dashboard/provider/visits/${VISIT_ID}/scribe`)
  const alert = page.getByRole('alert').filter({ hasText: 'The AI could not draft this note' })
  await expect(alert.getByTestId('scribe-error')).toHaveText(
    'The AI service could not be reached. Try again in a moment.'
  )

  await alert.getByRole('button', { name: 'Write note manually' }).click()
  await expect(page.getByRole('dialog').getByText('Document this visit')).toBeVisible()
  await page.keyboard.press('Escape')

  await alert.getByRole('button', { name: 'Retry' }).click()
  expect(scribe.calls).toContain(`POST /ai-scribe/session/${SESSION_ID}/process`)
  await expect(
    page.getByRole('region', { name: 'Review AI draft' }).getByLabel('Assessment')
  ).toHaveValue('Synthetic: lumbar strain, improving.')
  expectNoPhiInUrls(scribe)
})

test('provider: an unconfigured scribe says so and does not offer recording', async ({ page }) => {
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  await installScribeMock(page, { available: false })

  await page.goto(`/dashboard/provider/visits/${VISIT_ID}/scribe`)
  await expect(page.getByText(/The AI scribe is not set up on this server/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Upload a recording' })).toBeDisabled()
  // The demo and the manual note remain.
  await expect(page.getByRole('button', { name: 'Demo: simulate conversation' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Write note manually' })).toBeEnabled()
})

test('patient: declines AI recording from the join link; the visit still goes ahead', async ({
  page,
}) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const scribe = await installScribeMock(page)

  await page.goto(`/consultation/${JOIN_TOKEN}`)
  await expect(page.getByText('Recording Consent Required')).toBeVisible()
  await expect(page.getByText(/Saying no does not affect your care/)).toBeVisible()
  await page.getByRole('button', { name: 'No, do not record' }).click()

  await expect(page.getByRole('heading', { name: 'Recording declined' })).toBeVisible()
  await expect(page.getByText(/will not be recorded/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Changed your mind? Allow recording' })
  ).toBeVisible()
  expect(scribe.calls).toContain('POST /consultations/consult-e2e/consent/decline')
})

test('patient: the portal lists published visit summaries', async ({ page }) => {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  const scribe = await installScribeMock(page)

  await page.goto('/account/summaries')
  const list = page.getByRole('list', { name: 'Visit summaries' })
  await expect(list.getByText('October 1, 2026')).toBeVisible()
  await expect(list.getByText('With Avery Stone')).toBeVisible()
  await expect(list.getByText('Synthetic: your back strain is healing.')).toBeVisible()
  await expect(list.getByText('Synthetic: come back in 4 days.')).toBeVisible()
  expectNoPhiInUrls(scribe)
})
