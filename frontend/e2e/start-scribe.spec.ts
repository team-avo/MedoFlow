/**
 * CTO-30 / CTO-31: Start scribe from the Appointments list, straight into
 * recording. An in-person visit shows audio recording only (no video
 * controls); the provider records the patient's spoken consent, recording
 * starts on its own, and the visit goes through to "Approve & send".
 * Mocked API; Chrome's fake microphone.
 */
import { expect, test } from '@playwright/test'
import { installMockApi, ok } from './mockApi'
import { installScribeMock, SESSION_ID } from './scribeMock'

test.use({
  timezoneId: 'UTC',
  locale: 'en-US',
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
})

const API = 'http://127.0.0.1:3999/api/v1'
const APPT = 'appt-start-scribe'
const CONSULT = 'consult-start-scribe'

test('list → Start scribe → consent → recording → approve, audio only in person', async ({
  page,
}) => {
  await installMockApi(page, {
    role: 'PROVIDER',
    signedIn: true,
    provider: { id: 'prov-e2e-1', isActive: true },
  })
  const scribe = await installScribeMock(page, { status: 'DRAFT_GENERATED' })
  const state = {
    consent: 'PENDING',
    recording: 'NOT_STARTED',
    aiScribeSessionId: null as string | null,
    calls: [] as string[],
  }
  const start = new Date(Date.now() + 5 * 60_000)
  const session = () => ({
    id: CONSULT,
    clinicId: 'clinic-e2e',
    appointmentId: APPT,
    providerId: 'prov-e2e-1',
    patientId: 'patient-e2e-1',
    status: state.recording === 'RECORDING' ? 'RECORDING' : 'READY',
    recordingStatus: state.recording,
    consentStatus: state.consent,
    consentGrantedAt: null,
    joinToken: 'join-start-scribe',
    recordingUrl: null,
    transcriptText: null,
    transcriptStatus: 'NONE',
    aiScribeSessionId: state.aiScribeSessionId,
    meetingRoomUrl: null,
    meetingRoomName: null,
    startedAt: null,
    endedAt: null,
    errorMessage: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    appointment: {
      id: APPT,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
      mode: 'IN_PERSON',
    },
    provider: { id: 'prov-e2e-1', firstName: 'Avery', lastName: 'Stone' },
    patient: { id: 'patient-e2e-1', name: 'Synthetic Patient' },
  })
  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const key = `${req.method()} ${new URL(req.url()).pathname.replace(/^\/api\/v1/, '')}`
    if (key === 'GET /appointments/provider') {
      return ok(route, {
        appointments: [
          {
            id: APPT,
            clinicId: 'clinic-e2e',
            locationId: 'loc-1',
            providerId: 'prov-e2e-1',
            serviceId: 'svc-1',
            patientId: 'patient-e2e-1',
            startTime: start.toISOString(),
            endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
            status: 'CONFIRMED',
            createdAt: start.toISOString(),
            updatedAt: start.toISOString(),
            location: { id: 'loc-1', name: 'Main' },
            service: { id: 'svc-1', name: 'Longevity consult' },
            patient: { id: 'patient-e2e-1', name: 'Synthetic Patient', email: 'p@example.test' },
            provider: { id: 'prov-e2e-1', firstName: 'Avery', lastName: 'Stone' },
          },
        ],
      })
    }
    if (key === `POST /appointments/${APPT}/consultation/start`)
      return ok(route, { session: session() })
    if (key === `GET /consultations/${CONSULT}`) return ok(route, { session: session() })
    if (key === `POST /consultations/${CONSULT}/consent/attest`) {
      state.calls.push(key)
      state.consent = 'GRANTED'
      return ok(route, { session: session() })
    }
    if (key === `POST /consultations/${CONSULT}/recording/start`) {
      state.calls.push(key)
      state.recording = 'RECORDING'
      return ok(route, { session: session() })
    }
    if (key === `POST /consultations/${CONSULT}/recording/stop`) {
      state.calls.push(key)
      state.recording = 'STOPPED'
      return ok(route, { session: session() })
    }
    if (key === `POST /consultations/${CONSULT}/recording/upload`) {
      state.calls.push(key)
      state.recording = 'STORED'
      return ok(route, { session: session() })
    }
    if (key === `POST /consultations/${CONSULT}/transcribe`) {
      state.calls.push(key)
      state.aiScribeSessionId = SESSION_ID
      return ok(route, { session: session(), aiScribeSessionId: SESSION_ID })
    }
    if (key === `POST /consultations/${CONSULT}/live-transcript`)
      return ok(route, { text: '', segment: 0 })
    return route.fallback()
  })

  await page.goto('/dashboard/appointments')
  await page.getByRole('link', { name: /Start scribe/ }).click()
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/provider/appointments/${APPT}/consultation\\?autostart=1`)
  )

  // In person: no video controls, audio recording only.
  const controls = page.getByTestId('consult-controls')
  await expect(controls).toBeVisible()
  await expect(controls.getByRole('button', { name: /video call/i })).toHaveCount(0)

  // Consent first, then recording starts by itself.
  await page
    .getByTestId('in-person-consent')
    .getByRole('button', { name: 'The patient agreed' })
    .click()
  await expect(controls.getByRole('button', { name: /stop recording/i })).toBeVisible()
  expect(state.calls).toEqual([
    `POST /consultations/${CONSULT}/consent/attest`,
    `POST /consultations/${CONSULT}/recording/start`,
  ])

  // Stop and send to the AI scribe; the draft comes back for approval.
  await controls.getByRole('button', { name: /stop recording/i }).click()
  await controls.getByRole('button', { name: /upload & transcribe/i }).click()
  await expect.poll(() => state.calls).toContain(`POST /consultations/${CONSULT}/transcribe`)
  await page.getByRole('button', { name: /Approve & send/ }).click()
  await expect.poll(() => scribe.approveBodies.length).toBe(1)
})
