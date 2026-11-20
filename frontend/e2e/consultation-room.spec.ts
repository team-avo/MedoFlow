/**
 * Demo feedback WS2: the provider's consultation room, in the browser:
 *  - the video and recording controls are both visible (side by side, not
 *    overlapping) before, during and after a call;
 *  - joining the call starts the recording when consent is granted, and the
 *    live transcript fills in on screen while the provider speaks
 *    (Chrome's fake microphone; the mock API answers each segment);
 *  - without consent the recording control stays visible, says why, and the
 *    provider is told the scribe did not start.
 *
 * 8x8's external_api.js is a stub that "joins" right away.
 */
import { expect, test, type Page } from '@playwright/test'
import { installMockApi, ok } from './mockApi'
import { installScribeMock, JOIN_TOKEN, SESSION_ID } from './scribeMock'

test.use({
  timezoneId: 'UTC',
  locale: 'en-US',
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
})

const APPOINTMENT_ID = 'appt-room-e2e'
const CONSULT_ID = 'consult-room-e2e'
const ROOM = 'vpaas-magic-cookie-e2e/MedoFlow-consult-room'
const API = 'http://127.0.0.1:3999/api/v1'

// Joins as soon as the page builds the call; window.__leaveCall() hangs up.
const JITSI_STUB = `
window.JitsiMeetExternalAPI = function (domain, options) {
  var handlers = {};
  var el = document.createElement('div');
  el.setAttribute('data-testid', 'jitsi-stub');
  el.style.height = '100%';
  el.textContent = 'In call: ' + options.roomName;
  options.parentNode.appendChild(el);
  this.addEventListener = function (name, fn) { handlers[name] = fn; };
  this.executeCommand = function () {};
  this.dispose = function () { el.remove(); };
  window.__leaveCall = function () { handlers.readyToClose && handlers.readyToClose(); };
  window.__fireCall = function (name, data) { handlers[name] && handlers[name](data); };
  setTimeout(function () { handlers.videoConferenceJoined && handlers.videoConferenceJoined({}); }, 50);
};`

interface RoomState {
  consentStatus: string
  recordingStatus: string
  status: string
  aiScribeSessionId: string | null
  calls: string[]
  segments: number[]
}

const session = (s: RoomState) => ({
  id: CONSULT_ID,
  clinicId: 'clinic-e2e',
  appointmentId: APPOINTMENT_ID,
  providerId: 'prov-e2e-1',
  patientId: 'patient-e2e-1',
  status: s.status,
  recordingStatus: s.recordingStatus,
  consentStatus: s.consentStatus,
  consentGrantedAt: null,
  joinToken: JOIN_TOKEN,
  recordingUrl: null,
  transcriptText: null,
  transcriptStatus: 'NONE',
  aiScribeSessionId: s.aiScribeSessionId,
  meetingRoomUrl: null,
  meetingRoomName: null,
  startedAt: null,
  endedAt: null,
  errorMessage: null,
  createdAt: '2026-11-04T08:00:00.000Z',
  updatedAt: '2026-11-04T08:00:00.000Z',
  appointment: {
    id: APPOINTMENT_ID,
    startTime: '2026-11-04T15:00:00.000Z',
    endTime: '2026-11-04T15:30:00.000Z',
  },
  provider: { id: 'prov-e2e-1', firstName: 'Avery', lastName: 'Stone' },
  patient: { id: 'patient-e2e-1', name: 'Synthetic Patient' },
})

/**
 * CTO-41: the server returns the verbatim text plus speaker turns, so the
 * panel can label who spoke. `text` keeps the prefixes, as the real server does.
 */
const CAPTIONS: Array<{ text: string; turns: Array<{ speaker: string; text: string }> }> = [
  {
    text: 'Provider: How have you been since the last visit?',
    turns: [{ speaker: 'PROVIDER', text: 'How have you been since the last visit?' }],
  },
  {
    text: 'Patient: Better. The fatigue is easing.',
    turns: [{ speaker: 'PATIENT', text: 'Better. The fatigue is easing.' }],
  },
  {
    text: 'Provider: Any trouble sleeping?',
    turns: [{ speaker: 'PROVIDER', text: 'Any trouble sleeping?' }],
  },
]

async function openRoom(
  page: Page,
  consentStatus: string,
  /** CTO-41: false models a Whisper deployment — no turns, no labels. */
  opts: { speakerLabels?: boolean } = {}
): Promise<RoomState> {
  const speakerLabels = opts.speakerLabels !== false
  await installMockApi(page, { role: 'PROVIDER', signedIn: true })
  await installScribeMock(page, { liveSpeakerLabels: speakerLabels })
  await page.route('https://8x8.vc/external_api.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: JITSI_STUB })
  )
  const state: RoomState = {
    consentStatus,
    recordingStatus: 'NOT_STARTED',
    status: 'READY',
    aiScribeSessionId: null,
    calls: [],
    segments: [],
  }
  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const key = `${req.method()} ${new URL(req.url()).pathname.replace(/^\/api\/v1/, '')}`
    if (key === `POST /appointments/${APPOINTMENT_ID}/consultation/start`)
      return ok(route, { session: session(state) })
    if (key === `GET /consultations/${CONSULT_ID}`) return ok(route, { session: session(state) })
    if (key === `POST /consultations/${CONSULT_ID}/video-room`) {
      state.calls.push(key)
      return ok(route, {
        domain: '8x8.vc',
        roomName: ROOM,
        roomUrl: `https://8x8.vc/${ROOM}`,
        jwt: 'provider.jwt',
        jaasEnabled: true,
      })
    }
    if (key === `POST /consultations/${CONSULT_ID}/recording/start`) {
      state.calls.push(key)
      Object.assign(state, { recordingStatus: 'RECORDING', status: 'RECORDING' })
      return ok(route, { session: session(state) })
    }
    if (key === `POST /consultations/${CONSULT_ID}/recording/stop`) {
      state.calls.push(key)
      Object.assign(state, { recordingStatus: 'STOPPED', status: 'ENDED' })
      return ok(route, { session: session(state) })
    }
    if (key === `POST /consultations/${CONSULT_ID}/recording/upload`) {
      state.calls.push(key)
      Object.assign(state, { recordingStatus: 'STORED' })
      return ok(route, { session: session(state) })
    }
    if (key === `POST /consultations/${CONSULT_ID}/transcribe`) {
      state.calls.push(key)
      Object.assign(state, { aiScribeSessionId: SESSION_ID, status: 'PROCESSING' })
      return ok(route, { session: session(state), aiScribeSessionId: SESSION_ID })
    }
    if (key === `POST /consultations/${CONSULT_ID}/video/auto-ended`) {
      state.calls.push(key)
      return ok(route, { sessionId: CONSULT_ID })
    }
    if (key === `POST /consultations/${CONSULT_ID}/live-transcript`) {
      const seq = state.segments.length
      state.segments.push(req.postDataBuffer()?.length ?? 0)
      const caption = CAPTIONS[seq % CAPTIONS.length]!
      return ok(route, {
        text: caption.text,
        segment: seq,
        // A Whisper server sends no turns at all.
        ...(speakerLabels ? { turns: caption.turns } : {}),
      })
    }
    return route.fallback()
  })
  await page.goto(`/dashboard/provider/appointments/${APPOINTMENT_ID}/consultation`)
  await expect(page.getByTestId('consult-controls')).toBeVisible()
  return state
}

/** Both controls are on screen, side by side, and neither covers the other. */
async function expectBothVisible(page: Page, video: RegExp, recording: RegExp) {
  const bar = page.getByTestId('consult-controls')
  const v = bar.getByRole('button', { name: video })
  const r = bar.getByRole('button', { name: recording })
  await expect(v).toBeVisible()
  await expect(r).toBeVisible()
  await expect(v).toBeInViewport()
  await expect(r).toBeInViewport()
  const [a, b] = [await v.boundingBox(), await r.boundingBox()]
  const overlap =
    a!.x < b!.x + b!.width &&
    b!.x < a!.x + a!.width &&
    a!.y < b!.y + b!.height &&
    b!.y < a!.y + a!.height
  expect(overlap, 'video and recording buttons overlap').toBe(false)
  // Neither is a tiny pill next to a giant one.
  expect(Math.abs(a!.height - b!.height)).toBeLessThan(2)
}

test('consent granted: join the call → recording starts → live transcript appears → stop', async ({
  page,
}) => {
  const state = await openRoom(page, 'GRANTED')
  await expectBothVisible(page, /start video call/i, /start recording/i)

  await page.getByRole('button', { name: /start video call/i }).click()
  await expect(page.getByTestId('jitsi-stub')).toBeVisible()
  // Joining started the recording; both controls still on screen in the call.
  await expectBothVisible(page, /end video call/i, /stop recording/i)
  expect(state.calls).toContain(`POST /consultations/${CONSULT_ID}/recording/start`)

  // Live captions: the first segment closes after a few seconds.
  const panel = page.getByTestId('live-transcript')
  await expect(panel.getByRole('log')).toContainText(CAPTIONS[0]!.text, { timeout: 20_000 })
  // The strip holds only the last two turns, and at the CTO-41 cadence they
  // turn over every few seconds, so assert what it always shows rather than a
  // particular caption: a labelled line, and not the placeholder.
  const strip = page.getByTestId('live-caption-strip')
  await expect(strip).toContainText(/(Provider|Patient):\s\S/)
  await expect(strip).not.toContainText('Listening')
  await expect(panel).toContainText('Live')
  expect(state.segments[0]).toBeGreaterThan(0) // real audio from the fake mic

  // CTO-41 AC2: who spoke is shown, from the provider's own turns.
  await expect(panel.getByRole('log')).toContainText('Provider:')
  await expect(page.getByTestId('caption-speaker').first()).toBeVisible()

  // CTO-41 AC1: the measured delay is on screen, behind its toggle so it does
  // not distract mid-consult. Shape only: a fake-mic CI box is not a latency
  // gate, and asserting a threshold here would be a flaky performance test.
  await page.getByTestId('caption-latency-toggle').click()
  await expect(page.getByTestId('caption-latency')).toContainText(/p95\s+\d+(\.\d)?\s*s/)
  await expect(page.getByTestId('caption-latency')).toHaveAttribute('aria-live', 'off')

  // The cadence keeps rotating segments at the shorter length.
  await expect.poll(() => state.segments.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2)

  // Stop recording during the call: the call stays, the recording is ready to send.
  await page.getByRole('button', { name: /stop recording/i }).click()
  await expectBothVisible(page, /end video call/i, /upload & transcribe/i)
  expect(state.calls).toContain(`POST /consultations/${CONSULT_ID}/recording/stop`)
})

test('a provider that cannot label speakers still shows plain captions (CTO-41)', async ({
  page,
}) => {
  // Whisper (OpenAI, Groq, self-hosted) cannot diarize, so captions must look
  // exactly as they did before CTO-41: text, no speaker, no empty gutter.
  const state = await openRoom(page, 'GRANTED', { speakerLabels: false })
  await page.getByRole('button', { name: /start video call/i }).click()
  await expect(page.getByTestId('jitsi-stub')).toBeVisible()

  const log = page.getByTestId('live-transcript').getByRole('log')
  await expect(log).toContainText('How have you been since the last visit?', { timeout: 20_000 })
  expect(state.segments[0]).toBeGreaterThan(0)

  // The raw text keeps whatever the provider said, but nothing is presented as
  // an attributed speaker.
  await expect(page.getByTestId('caption-speaker')).toHaveCount(0)

  // The delay figure is still measured and reported: that is independent of labels.
  await page.getByTestId('caption-latency-toggle').click()
  await expect(page.getByTestId('caption-latency')).toContainText(/p95/)
})

test('consent pending: recording stays visible with its reason; joining says it did not start', async ({
  page,
}) => {
  const state = await openRoom(page, 'PENDING')
  const start = page.getByRole('button', { name: /start recording/i })
  await expect(start).toBeDisabled()
  await expect(page.getByTestId('recording-blocked-reason')).toContainText(/consent/i)

  await page.getByRole('button', { name: /start video call/i }).click()
  await expect(page.getByTestId('jitsi-stub')).toBeVisible()
  await expect(page.getByText(/not recording yet: waiting for the patient/i)).toBeVisible()
  await expectBothVisible(page, /end video call/i, /start recording/i)
  expect(state.calls).not.toContain(`POST /consultations/${CONSULT_ID}/recording/start`)

  // The patient consents while the provider waits: recording unlocks in the call.
  state.consentStatus = 'GRANTED'
  await expect(start).toBeEnabled({ timeout: 10_000 })
  await start.click()
  await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible()
  expect(state.calls).toContain(`POST /consultations/${CONSULT_ID}/recording/start`)
})

test('ending the call from our controls hands the recording to the AI scribe', async ({ page }) => {
  const state = await openRoom(page, 'GRANTED')
  await page.getByRole('button', { name: /start video call/i }).click()
  await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible()
  await page.getByRole('button', { name: /end video call/i }).click()
  await expect(page.getByTestId('jitsi-stub')).toHaveCount(0)
  // Stop → upload → transcribe, with no click; both controls stay on screen
  // (the recording control shows the scribe working on it).
  await expectBothVisible(page, /start video call/i, /transcribing|sent to ai scribe/i)
  expect(state.calls).toEqual(
    expect.arrayContaining([
      `POST /consultations/${CONSULT_ID}/recording/stop`,
      `POST /consultations/${CONSULT_ID}/recording/upload`,
      `POST /consultations/${CONSULT_ID}/transcribe`,
    ])
  )
})

// CTO-35: left alone and silent, the call asks, then ends itself (audited)
// and the recording is handed to the AI scribe like any other end of call.
test('an idle call asks "Are you still there?", then ends and keeps the recording', async ({
  page,
}) => {
  await page.clock.install()
  const state = await openRoom(page, 'GRANTED')
  await page.getByRole('button', { name: /start video call/i }).click()
  await page.clock.runFor(1_000)
  await expect(page.getByTestId('jitsi-stub')).toBeVisible()
  await page.evaluate(() => {
    const w = window as unknown as { __fireCall: (n: string, d?: unknown) => void }
    w.__fireCall('participantJoined', { id: 'patient' })
    w.__fireCall('participantLeft', { id: 'patient' })
  })
  await page.clock.runFor(61_000)
  await expect(page.getByTestId('idle-call-prompt')).toContainText('Are you still there?')
  await page.clock.runFor(31_000)
  await expect(page.getByTestId('jitsi-stub')).toHaveCount(0)
  await expect
    .poll(() => state.calls)
    .toEqual(
      expect.arrayContaining([
        `POST /consultations/${CONSULT_ID}/video/auto-ended`,
        `POST /consultations/${CONSULT_ID}/recording/stop`,
      ])
    )
})
