/**
 * F0.4.2 (c) / F9.4 — PHI boundary in the patient portal: only the published
 * patient summary is shown. Internal SOAP sections, provider notes and the
 * consultation transcript never render — even if an API response were to
 * carry them (defence in depth on top of the backend sanitiser).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'appt-1' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const INTERNAL = {
  subjective: 'INTERNAL-SUBJECTIVE patient anxious about results',
  objective: 'INTERNAL-OBJECTIVE BP 150/95',
  assessment: 'INTERNAL-ASSESSMENT rule out secondary cause',
  plan: 'INTERNAL-PLAN order renal panel',
  note: 'INTERNAL-NOTE do not share with patient',
  transcript: 'INTERNAL-TRANSCRIPT full recording text',
  aiDraft: 'INTERNAL-AIDRAFT unreviewed draft',
}

let visit: unknown
vi.mock('@/lib/patientApi', () => ({
  getAppointmentById: vi.fn(async () => ({
    id: 'appt-1',
    clinicId: 'c1',
    patientId: 'p1',
    status: 'COMPLETED',
    startTime: '2026-10-01T10:00:00.000Z',
    endTime: '2026-10-01T10:30:00.000Z',
    service: { id: 's1', name: 'Follow-up', duration: 30 },
    provider: { id: 'pr1', firstName: 'Synthetic', lastName: 'Provider' },
    clinic: { id: 'c1', name: 'Clinic' },
    patient: { id: 'p1', name: 'Synthetic Patient', email: 'patient@example.test' },
  })),
  getVisitByAppointment: vi.fn(async () => visit),
  getMyPrescriptions: vi.fn(async () => []),
}))
vi.mock('@/lib/formsApi', () => ({ getPatientForms: vi.fn(async () => []) }))
vi.mock('@/lib/consultationApi', () => ({
  getByAppointment: vi.fn(async () => ({
    id: 'cs1',
    joinToken: null,
    consentStatus: 'GRANTED',
    transcript: INTERNAL.transcript,
  })),
}))
vi.mock('@/components/PatientFilesSection', () => ({ PatientFilesSection: () => null }))
vi.mock('@/components/intake/IntakeFormsSection', () => ({ IntakeFormsSection: () => null }))

import PatientAppointmentDetailPage from '@/app/(public)/account/appointments/[id]/page'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PatientAppointmentDetailPage />
    </QueryClientProvider>
  )
}

const expectNoInternalText = () => {
  const text = document.body.textContent ?? ''
  for (const value of Object.values(INTERNAL)) expect(text).not.toContain(value.split(' ')[0])
}

beforeEach(() => {
  visit = null
})

describe('patient portal PHI boundary', () => {
  it('a published summary is shown; internal note sections and the transcript are not', async () => {
    visit = {
      visitRecord: { id: 'v1', status: 'FINALIZED', isFinalized: true, ...INTERNAL },
      patientSummary: {
        diagnosis: 'Published: blood pressure is a little high',
        treatmentPlan: 'Published: daily walk, low-salt diet',
        nextSteps: 'Published: recheck in 4 weeks',
      },
    }
    renderPage()
    expect(
      await screen.findByText('Published: blood pressure is a little high')
    ).toBeInTheDocument()
    expect(screen.getByText('Published: recheck in 4 weeks')).toBeInTheDocument()
    expectNoInternalText()
  })

  it('with no published summary the portal shows a placeholder — never the draft or the note', async () => {
    visit = { visitRecord: { id: 'v1', status: 'DRAFT', isFinalized: false, ...INTERNAL } }
    renderPage()
    expect(await screen.findByText('Clinical documentation in progress')).toBeInTheDocument()
    expectNoInternalText()
  })
})
