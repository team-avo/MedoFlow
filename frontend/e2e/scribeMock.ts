/**
 * Stateful stand-in for the AI scribe API (Component 2 e2e), layered over
 * installMockApi's auth contract with page.route() — anything not handled
 * here falls back to the auth mock.
 *
 *  provider: consent → (demo) draft → edit → "Approve & send"; a failed run
 *            → Retry → draft; an unconfigured server
 *  patient:  join link consent decline; the portal's published summaries
 *
 * Every URL is recorded so specs can prove no patient detail lands in a URL.
 * Synthetic data only.
 */
import { type Page, type Route } from '@playwright/test'
import { ok } from './mockApi'

export const VISIT_ID = 'visit-scribe-e2e'
export const SESSION_ID = 'scribe-session-e2e'
export const JOIN_TOKEN = 'join-token-e2e'
export const CONSULTATION_ID = 'consult-e2e'

export interface ScribeMockOptions {
  status?: 'RECORDING' | 'FAILED' | 'DRAFT_GENERATED'
  consent?: 'GRANTED' | 'PENDING' | 'DECLINED'
  available?: boolean
}

export interface ScribeMockState {
  status: string
  consent: string
  summaryPublished: boolean
  approveBodies: Record<string, unknown>[]
  calls: string[]
  urls: string[]
  consultationConsent: string
}

const SOAP = {
  subjective: 'Synthetic: lower back stiffness in the mornings.',
  objective: 'Synthetic: restricted lumbar flexion.',
  assessment: 'Synthetic: lumbar strain, improving.',
  plan: 'Synthetic: core exercises 3x10 twice daily.',
}
const SUMMARY = {
  diagnosis: 'Synthetic: your back strain is healing.',
  treatmentPlan: 'Synthetic: two core exercises, twice a day.',
  nextSteps: 'Synthetic: come back in 4 days.',
}

export async function installScribeMock(page: Page, opts: ScribeMockOptions = {}) {
  const state: ScribeMockState = {
    status: opts.status ?? 'RECORDING',
    consent: opts.consent ?? 'GRANTED',
    summaryPublished: false,
    approveBodies: [],
    calls: [],
    urls: [],
    consultationConsent: 'PENDING',
  }
  page.on('request', (r) => state.urls.push(r.url()))
  page.on('framenavigated', (f) => state.urls.push(f.url()))

  const drafted = () => ['DRAFT_GENERATED', 'EDITED', 'APPROVED'].includes(state.status)
  const session = () => ({
    id: SESSION_ID,
    visitRecordId: VISIT_ID,
    providerId: 'prov-e2e-1',
    clinicId: 'clinic-e2e',
    audioUrl: state.status === 'FAILED' ? 'local:uploads/ai-scribe/x/audio.webm' : null,
    transcript: drafted()
      ? 'Provider: How is the back?\nPatient: Still stiff in the mornings.'
      : null,
    timeline: drafted()
      ? {
          symptoms: ['back stiffness'],
          duration: 'weeks',
          assessment: 'Lumbar strain',
          plan: ['Core exercises'],
          continuity: 'Synthetic: since the last visit, stiffness is easing.',
        }
      : null,
    aiDraft: drafted() ? SOAP : null,
    patientSummary: drafted() ? SUMMARY : null,
    patientSummaryPublished: state.summaryPublished,
    status: state.status,
    aiModel: drafted() ? 'mock-scribe-1' : null,
    aiProvider: drafted() ? 'mock:mock' : null,
    errorMessage:
      state.status === 'FAILED'
        ? 'The AI service could not be reached. Try again in a moment.'
        : null,
    processingCompletedAt: drafted() ? '2026-10-29T09:00:00.000Z' : null,
    consent: { status: state.consent, source: state.consent === 'GRANTED' ? 'BOOKING' : null },
    createdAt: '2026-10-29T08:00:00.000Z',
    updatedAt: '2026-10-29T09:00:00.000Z',
    visitRecord: {
      id: VISIT_ID,
      appointmentId: 'appt-scribe-e2e',
      patientId: 'patient-e2e-1',
      isFinalized: state.status === 'APPROVED',
    },
  })

  await page.route('http://127.0.0.1:3999/**', async (route: Route) => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fallback()
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '')
    const body = (req.postDataJSON?.() ?? {}) as Record<string, unknown>
    const key = `${method} ${path}`

    if (key === 'GET /ai-scribe/capabilities') {
      const available = opts.available ?? true
      const model = (kind: string) => ({
        kind,
        preset: kind,
        model: available ? 'mock-scribe-1' : '',
        location: 'in-process',
      })
      return ok(route, {
        capabilities: {
          available,
          transcriptionAvailable: available,
          draftingAvailable: available,
          demoEnabled: true,
          llm: model(available ? 'mock' : 'disabled'),
          stt: model(available ? 'mock' : 'disabled'),
        },
      })
    }
    if (key === `GET /ai-scribe/session/visit/${VISIT_ID}`) return ok(route, { session: session() })
    if (key === `GET /ai-scribe/session/${SESSION_ID}`) return ok(route, { session: session() })
    if (key === `POST /ai-scribe/session/${SESSION_ID}/consent`) {
      state.calls.push(key)
      state.consent = 'GRANTED'
      return ok(route, { session: session() })
    }
    if (key === `POST /ai-scribe/session/${SESSION_ID}/simulate`) {
      state.calls.push(key)
      state.status = 'DRAFT_GENERATED'
      return ok(route, { session: session() })
    }
    if (key === `POST /ai-scribe/session/${SESSION_ID}/process`) {
      state.calls.push(key)
      // The worker picks it up; the next poll sees the draft.
      state.status = 'TRANSCRIBING'
      const now = session()
      state.status = 'DRAFT_GENERATED'
      return ok(route, { session: now })
    }
    if (key === `PUT /ai-scribe/session/${SESSION_ID}/draft`) {
      state.calls.push(key)
      state.status = 'EDITED'
      return ok(route, { session: session() })
    }
    if (key === `POST /ai-scribe/session/${SESSION_ID}/approve`) {
      state.calls.push(key)
      state.approveBodies.push(body)
      state.status = 'APPROVED'
      state.summaryPublished = body.sendToPatient === true
      return ok(route, { session: { ...session(), rxCart: null } })
    }
    if (key === `GET /ai-scribe/session/${SESSION_ID}/longitudinal`) {
      return ok(route, {
        visits: [
          {
            visitRecordId: 'visit-prior-e2e',
            date: '2026-10-01T10:00:00.000Z',
            assessment: 'Synthetic: acute lumbar strain.',
            plan: 'Synthetic: rest and gentle stretches.',
            products: [{ name: 'Magnesium Glycinate', dose: '400 mg', quantity: 1 }],
          },
        ],
      })
    }
    if (key === `GET /rx-cart/sessions/${SESSION_ID}/proposal`) return ok(route, { proposal: null })
    if (key === `GET /visits/${VISIT_ID}`) {
      return ok(route, {
        visitRecord: {
          id: VISIT_ID,
          appointmentId: 'appt-scribe-e2e',
          patientId: 'patient-e2e-1',
          subjective: null,
          objective: null,
          assessment: null,
          plan: null,
          status: 'DRAFT',
          isFinalized: false,
          versions: [],
        },
      })
    }

    // ── patient ──
    if (key === `GET /consultations/join/${JOIN_TOKEN}`) {
      return ok(route, {
        session: {
          id: CONSULTATION_ID,
          status: 'READY',
          recordingStatus: 'NOT_STARTED',
          consentStatus: state.consultationConsent,
          consentGrantedAt: null,
          joinToken: JOIN_TOKEN,
          createdAt: '2026-10-29T08:00:00.000Z',
          appointment: {
            id: 'appt-scribe-e2e',
            startTime: '2026-10-29T15:00:00.000Z',
            endTime: '2026-10-29T15:30:00.000Z',
          },
          provider: { firstName: 'Avery', lastName: 'Stone' },
        },
      })
    }
    if (key === `GET /consultations/join/${JOIN_TOKEN}/video-token`) {
      return ok(route, { room: null })
    }
    if (key === `POST /consultations/${CONSULTATION_ID}/consent/decline`) {
      state.calls.push(key)
      state.consultationConsent = 'DECLINED'
      return ok(route, { session: { id: CONSULTATION_ID, consentStatus: 'DECLINED' } })
    }
    if (key === 'GET /visits/me/summaries') {
      return ok(route, {
        summaries: [
          {
            sessionId: 'sum-1',
            visitRecordId: 'visit-prior-e2e',
            appointmentId: 'appt-prior-e2e',
            visitDate: '2026-10-01T10:00:00.000Z',
            providerName: 'Avery Stone',
            publishedAt: '2026-10-01T11:00:00.000Z',
            summary: SUMMARY,
          },
        ],
      })
    }
    return route.fallback()
  })

  return state
}
