/**
 * Video consultations (8x8 JaaS) in the browser, mocked API.
 *  - provider: "Start Video Call" opens the room inside the consultation page
 *  - patient: the join link's "Join video consultation" opens the same room
 *  - a server without JaaS, and an expired link, say so instead of waiting
 *
 * 8x8's external_api.js is replaced by a stub that records what the page
 * passed to Jitsi, so nothing leaves the machine.
 */
import { expect, test, type Page, type Route } from '@playwright/test'
import { fail, installMockApi, ok } from './mockApi'
import { installScribeMock, JOIN_TOKEN } from './scribeMock'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

const APPOINTMENT_ID = 'appt-video-e2e'
const CONSULT_ID = 'consult-video-e2e'
const ROOM = 'vpaas-magic-cookie-e2e/MedoFlow-consult-v-1a2b3c4d'
const API = 'http://127.0.0.1:3999/api/v1'

const JITSI_STUB = `
window.JitsiMeetExternalAPI = function (domain, options) {
  window.__jitsi = {
    domain: domain,
    roomName: options.roomName,
    jwt: options.jwt,
    toolbar: options.configOverwrite.toolbarButtons,
  };
  var el = document.createElement('div');
  el.setAttribute('data-testid', 'jitsi-stub');
  el.textContent = 'In call: ' + options.roomName;
  options.parentNode.appendChild(el);
  this.addEventListener = function () {};
  this.executeCommand = function () {};
  this.dispose = function () { el.remove(); };
};`

const room = (jwt: string) => ({
  domain: '8x8.vc',
  roomName: ROOM,
  roomUrl: `https://8x8.vc/${ROOM}`,
  jwt,
  jaasEnabled: true,
})

async function stubJitsi(page: Page) {
  await page.route('https://8x8.vc/external_api.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: JITSI_STUB })
  )
}

const consultation = (consentStatus: string) => ({
  id: CONSULT_ID,
  clinicId: 'clinic-e2e',
  appointmentId: APPOINTMENT_ID,
  providerId: 'prov-e2e-1',
  patientId: 'patient-e2e-1',
  status: 'READY',
  recordingStatus: 'NOT_STARTED',
  consentStatus,
  consentGrantedAt: null,
  joinToken: JOIN_TOKEN,
  recordingUrl: null,
  transcriptText: null,
  transcriptStatus: 'NONE',
  aiScribeSessionId: null,
  meetingRoomUrl: null,
  meetingRoomName: null,
  startedAt: null,
  endedAt: null,
  errorMessage: null,
  createdAt: '2026-10-29T08:00:00.000Z',
  updatedAt: '2026-10-29T08:00:00.000Z',
  appointment: {
    id: APPOINTMENT_ID,
    startTime: '2026-10-29T15:00:00.000Z',
    endTime: '2026-10-29T15:30:00.000Z',
  },
  provider: { id: 'prov-e2e-1', firstName: 'Avery', lastName: 'Stone' },
  patient: { id: 'patient-e2e-1', name: 'Synthetic Patient' },
})

test('provider: "Start Video Call" opens the 8x8 room inside the consultation page', async ({
  page,
}) => {
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  await installScribeMock(page)
  await stubJitsi(page)
  const calls: string[] = []
  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const key = `${req.method()} ${new URL(req.url()).pathname.replace(/^\/api\/v1/, '')}`
    if (key === `POST /appointments/${APPOINTMENT_ID}/consultation/start`) {
      return ok(route, { session: consultation('DECLINED') })
    }
    if (key === `GET /consultations/${CONSULT_ID}`) {
      return ok(route, { session: consultation('DECLINED') })
    }
    if (key === `POST /consultations/${CONSULT_ID}/video-room`) {
      calls.push(key)
      return ok(route, room('provider.jwt'))
    }
    return route.fallback()
  })

  await page.goto(`/dashboard/provider/appointments/${APPOINTMENT_ID}/consultation`)
  await page.getByRole('button', { name: 'Start Video Call' }).click()

  await expect(page.getByTestId('jitsi-stub')).toHaveText(`In call: ${ROOM}`)
  expect(calls).toEqual([`POST /consultations/${CONSULT_ID}/video-room`])
  const jitsi = await page.evaluate(() => (window as any).__jitsi)
  expect(jitsi).toMatchObject({ domain: '8x8.vc', roomName: ROOM, jwt: 'provider.jwt' })
  expect(jitsi.toolbar).not.toContain('recording')
  expect(jitsi.toolbar).not.toContain('livestreaming')
})

test('provider: a server without video set up says so', async ({ page }) => {
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  await installScribeMock(page)
  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const key = `${req.method()} ${new URL(req.url()).pathname.replace(/^\/api\/v1/, '')}`
    if (key === `POST /appointments/${APPOINTMENT_ID}/consultation/start`) {
      return ok(route, { session: consultation('DECLINED') })
    }
    if (key === `GET /consultations/${CONSULT_ID}`) {
      return ok(route, { session: consultation('DECLINED') })
    }
    if (key === `POST /consultations/${CONSULT_ID}/video-room`) {
      return fail(route, 503, 'video_not_configured', 'Video calls are not set up on this server')
    }
    return route.fallback()
  })

  await page.goto(`/dashboard/provider/appointments/${APPOINTMENT_ID}/consultation`)
  await page.getByRole('button', { name: 'Start Video Call' }).click()
  await expect(page.getByText('Video calls are not set up on this server')).toBeVisible()
  await expect(page.getByTestId('jitsi-stub')).toHaveCount(0)
})

/** Patient join page with the given answer from the video-token endpoint. */
async function patientWith(page: Page, videoToken: (route: Route) => Promise<void>) {
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  await stubJitsi(page)
  await page.route(`${API}/consultations/join/${JOIN_TOKEN}**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS') return route.fallback()
    if (path.endsWith('/video-token')) return videoToken(route)
    return ok(route, { session: consultation('DECLINED') })
  })
}

test('patient: "Join video consultation" opens the same room', async ({ page }) => {
  await patientWith(page, (route) => ok(route, room('patient.jwt')))
  await page.goto(`/consultation/${JOIN_TOKEN}`)
  await page.getByRole('button', { name: 'Join video consultation' }).click()
  await expect(page.getByTestId('jitsi-stub')).toHaveText(`In call: ${ROOM}`)
  const jitsi = await page.evaluate(() => (window as any).__jitsi)
  expect(jitsi).toMatchObject({ roomName: ROOM, jwt: 'patient.jwt' })
})

test('patient: no video set up — says so instead of waiting', async ({ page }) => {
  await patientWith(page, (route) =>
    fail(route, 503, 'video_not_configured', 'Video calls are not set up on this server')
  )
  await page.goto(`/consultation/${JOIN_TOKEN}`)
  await expect(
    page.getByText('Video calls are not set up yet. Please contact your clinic.')
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join video consultation' })).toHaveCount(0)
})

test('patient: an ended consultation says so', async ({ page }) => {
  await patientWith(page, (route) =>
    fail(route, 410, 'consultation_ended', 'This consultation has ended')
  )
  await page.goto(`/consultation/${JOIN_TOKEN}`)
  await expect(page.getByText('This consultation has ended')).toBeVisible()
})
