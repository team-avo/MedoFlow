/**
 * Component 2 — the shared scribe review core (F2.1 – F2.5).
 *  F2.1 / F2.3  the provider edits note + patient summary; "Approve & send"
 *               sends exactly what is on screen, and is blocked until the
 *               note, the summary and any detected products are confirmed
 *  FR-1         consent panel: attest only after the explicit tick; decline → manual
 *  FR-11        failed state: safe reason, Retry and the manual fallback
 *  FR-7         continuity shown for review; record over time listed
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const scribeApi = vi.hoisted(() => ({
  approveSession: vi.fn(),
  updateDraft: vi.fn(),
  regenerateDraft: vi.fn(),
  getLongitudinal: vi.fn(),
}))
vi.mock('@/lib/aiScribeApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/aiScribeApi')>()),
  ...scribeApi,
}))
const rxApi = vi.hoisted(() => ({ getProposal: vi.fn(), getCatalog: vi.fn() }))
vi.mock('@/lib/rxCartApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rxCartApi')>()),
  ...rxApi,
}))
const toastApi = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/hooks/useAppToast', () => ({ useAppToast: () => toastApi }))

import { approveBlockedReason, ScribeReviewPanel } from '@/components/aiScribe/ScribeReviewPanel'
import {
  ScribeApprovedPanel,
  ScribeConsentPanel,
  ScribeFailedPanel,
  ScribeProcessingPanel,
} from '@/components/aiScribe/ScribeStatusPanels'
import { LongitudinalPanel } from '@/components/aiScribe/LongitudinalPanel'
import { NoteHistoryModal } from '@/components/visit/NoteHistoryModal'
import { rxApproval } from '@/components/rxCart/DetectedProductsPanel'
import type { AIScribeSession } from '@/lib/aiScribeApi'

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  )

const session = (over: Partial<AIScribeSession> = {}): AIScribeSession => ({
  id: 'sess_1',
  visitRecordId: 'visit_1',
  providerId: 'prov_1',
  clinicId: 'clinic_1',
  audioUrl: 'local:uploads/ai-scribe/sess_1/audio.webm',
  transcript: 'Provider: How are you?\nPatient: Tired.',
  timeline: { symptoms: ['fatigue'], duration: null, assessment: null, plan: [] },
  aiDraft: { subjective: 'Tired', objective: 'Alert', assessment: 'Fatigue', plan: 'Rest' },
  patientSummary: {
    diagnosis: 'You are tired',
    treatmentPlan: 'Rest',
    nextSteps: 'Return in 6 weeks',
  },
  status: 'DRAFT_GENERATED',
  patientSummaryPublished: false,
  aiModel: 'gpt-4o-mini',
  aiProvider: 'openai-compatible:openai@api.openai.com',
  processingCompletedAt: '2026-10-29T10:00:00.000Z',
  createdAt: '2026-10-29T09:00:00.000Z',
  updatedAt: '2026-10-29T10:00:00.000Z',
  visitRecord: { id: 'visit_1', appointmentId: 'appt_1', patientId: 'pat_1', isFinalized: false },
  ...over,
})

const approveButton = () => screen.getByRole('button', { name: /approve & send/i })

beforeEach(() => {
  vi.clearAllMocks()
  rxApi.getProposal.mockResolvedValue(null)
  rxApi.getCatalog.mockResolvedValue([])
})

describe('ScribeReviewPanel', () => {
  it('shows the draft, its provenance, and sends exactly what is on screen', async () => {
    const onSessionChange = vi.fn()
    scribeApi.approveSession.mockResolvedValue({ ...session(), status: 'APPROVED', rxCart: null })
    wrap(<ScribeReviewPanel session={session()} onSessionChange={onSessionChange} />)

    expect(screen.getByTestId('scribe-provenance').textContent).toBe(
      'Drafted by gpt-4o-mini · openai'
    )
    expect((screen.getByLabelText('Assessment') as HTMLTextAreaElement).value).toBe('Fatigue')
    expect((screen.getByLabelText('What to do next') as HTMLTextAreaElement).value).toBe(
      'Return in 6 weeks'
    )

    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'Rest and fluids' } })
    fireEvent.change(screen.getByLabelText('What we found'), {
      target: { value: 'Your tiredness is improving' },
    })
    fireEvent.click(approveButton())

    await waitFor(() => expect(scribeApi.approveSession).toHaveBeenCalledTimes(1))
    expect(scribeApi.approveSession).toHaveBeenCalledWith('sess_1', {
      rxConfirmation: undefined,
      sendToPatient: true,
      draft: {
        subjective: 'Tired',
        objective: 'Alert',
        assessment: 'Fatigue',
        plan: 'Rest and fluids',
      },
      patientSummary: {
        diagnosis: 'Your tiredness is improving',
        treatmentPlan: 'Rest',
        nextSteps: 'Return in 6 weeks',
      },
    })
    await waitFor(() => expect(onSessionChange).toHaveBeenCalled())
    expect(toastApi.success).toHaveBeenCalledWith('Note approved · summary sent to the patient')
  })

  it('blocks "Approve & send" until the patient summary has content', () => {
    wrap(
      <ScribeReviewPanel session={session({ patientSummary: null })} onSessionChange={vi.fn()} />
    )
    expect(approveButton()).toBeDisabled()
    expect(screen.getByTestId('approve-blocked').textContent).toBe(
      'Write the patient summary before sending it'
    )
    fireEvent.change(screen.getByLabelText('What to do next'), { target: { value: 'Come back' } })
    expect(approveButton()).not.toBeDisabled()
  })

  it('shows the API reason when approval is refused', async () => {
    scribeApi.approveSession.mockRejectedValue({
      response: { status: 409, data: { message: 'This visit already has a finalized note' } },
    })
    wrap(<ScribeReviewPanel session={session()} onSessionChange={vi.fn()} />)
    fireEvent.click(approveButton())
    await waitFor(() =>
      expect(toastApi.error).toHaveBeenCalledWith('This visit already has a finalized note')
    )
  })

  it('saves the note and the summary together', async () => {
    scribeApi.updateDraft.mockResolvedValue(session({ status: 'EDITED' }))
    wrap(<ScribeReviewPanel session={session()} onSessionChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('What we recommended'), {
      target: { value: 'Walk daily' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(scribeApi.updateDraft).toHaveBeenCalledWith('sess_1', {
        subjective: 'Tired',
        objective: 'Alert',
        assessment: 'Fatigue',
        plan: 'Rest',
        patientSummary: {
          diagnosis: 'You are tired',
          treatmentPlan: 'Walk daily',
          nextSteps: 'Return in 6 weeks',
        },
      })
    )
  })

  it('regenerating resumes polling', async () => {
    const onProcessingStarted = vi.fn()
    scribeApi.regenerateDraft.mockResolvedValue(session({ status: 'TRANSCRIBING' }))
    wrap(
      <ScribeReviewPanel
        session={session()}
        onSessionChange={vi.fn()}
        onProcessingStarted={onProcessingStarted}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /regenerate draft/i }))
    await waitFor(() => expect(onProcessingStarted).toHaveBeenCalled())
  })

  it('a new draft reloads its detected products (the old lines are gone)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (s: AIScribeSession) => (
      <QueryClientProvider client={client}>
        <ScribeReviewPanel session={s} onSessionChange={vi.fn()} />
      </QueryClientProvider>
    )
    const { rerender } = render(ui(session()))
    await waitFor(() => expect(rxApi.getProposal).toHaveBeenCalled())
    const before = rxApi.getProposal.mock.calls.length

    rerender(ui(session({ processingCompletedAt: '2026-10-29T10:05:00.000Z' })))
    await waitFor(() => expect(rxApi.getProposal.mock.calls.length).toBeGreaterThan(before))
    expect(rxApi.getProposal).toHaveBeenLastCalledWith('sess_1')
  })

  it('FR-7: the "since the last visit" line is shown for review', () => {
    wrap(
      <ScribeReviewPanel
        session={session({
          timeline: {
            symptoms: [],
            duration: null,
            assessment: null,
            plan: [],
            continuity: 'Since the last visit: fatigue is improving.',
          },
        })}
        onSessionChange={vi.fn()}
      />
    )
    expect(screen.getByText('Since the last visit: fatigue is improving.')).toBeInTheDocument()
  })

  it('an approved or finalized note is read-only, with no approve button', () => {
    wrap(<ScribeReviewPanel session={session({ status: 'APPROVED' })} onSessionChange={vi.fn()} />)
    expect(screen.getByLabelText('Assessment')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /approve & send/i })).toBeNull()
  })
})

describe('approveBlockedReason', () => {
  const soap = { subjective: 'S', objective: '', assessment: '', plan: '' }
  const summary = { diagnosis: 'D', treatmentPlan: '', nextSteps: '' }
  it('names what is missing, in order', () => {
    expect(approveBlockedReason({ ...soap, subjective: ' ' }, summary, { ok: true })).toMatch(
      /clinical note/
    )
    expect(approveBlockedReason(soap, { ...summary, diagnosis: '' }, { ok: true })).toMatch(
      /patient summary/
    )
    expect(
      approveBlockedReason(
        soap,
        summary,
        rxApproval({ proposalId: 'p', confirmedLineIds: [], acknowledged: false })
      )
    ).toMatch(/Confirm the detected products/)
    expect(approveBlockedReason(soap, summary, { ok: true })).toBeNull()
  })
})

describe('state panels', () => {
  it('FR-1 consent: "Record consent" needs the explicit tick', () => {
    const onAttest = vi.fn()
    wrap(<ScribeConsentPanel consent={{ status: 'PENDING', source: null }} onAttest={onAttest} />)
    const record = screen.getByRole('button', { name: /record consent/i })
    expect(record).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/patient gave verbal consent/i))
    fireEvent.click(record)
    expect(onAttest).toHaveBeenCalledTimes(1)
  })

  it('FR-1 decline: no recording, only the manual note', () => {
    const onManual = vi.fn()
    wrap(
      <ScribeConsentPanel
        consent={{ status: 'DECLINED', source: null }}
        onAttest={vi.fn()}
        onManual={onManual}
      />
    )
    expect(screen.getByText(/declined AI recording/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /record consent/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /write note manually/i }))
    expect(onManual).toHaveBeenCalled()
  })

  it('consent already given renders nothing', () => {
    const { container } = wrap(
      <ScribeConsentPanel consent={{ status: 'GRANTED', source: 'BOOKING' }} />
    )
    expect(container.textContent).toBe('')
  })

  it('FR-11 failed: the safe reason, Retry and the manual fallback', () => {
    const onRetry = vi.fn()
    const onManual = vi.fn()
    wrap(
      <ScribeFailedPanel
        message="The AI service could not be reached. Try again in a moment."
        onRetry={onRetry}
        onManual={onManual}
      />
    )
    expect(screen.getByRole('alert').textContent).toMatch(/could not be reached/)
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    fireEvent.click(screen.getByRole('button', { name: /write note manually/i }))
    expect(onRetry).toHaveBeenCalled()
    expect(onManual).toHaveBeenCalled()
  })

  it('processing: upload progress, then a spinner, then "Check again" after the cap', () => {
    const onCheckAgain = vi.fn()
    const { rerender } = wrap(
      <ScribeProcessingPanel timedOut={false} onCheckAgain={onCheckAgain} uploadProgress={0.42} />
    )
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42')
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ScribeProcessingPanel timedOut onCheckAgain={onCheckAgain} />
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /check again/i }))
    expect(onCheckAgain).toHaveBeenCalled()
  })

  it('approved: published, or a way to send the summary', () => {
    const onPublish = vi.fn()
    const { rerender } = wrap(
      <ScribeApprovedPanel session={session({ status: 'APPROVED' })} onPublish={onPublish} />
    )
    fireEvent.click(screen.getByRole('button', { name: /send summary to patient/i }))
    expect(onPublish).toHaveBeenCalled()
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ScribeApprovedPanel
          session={session({ status: 'APPROVED', patientSummaryPublished: true })}
        />
      </QueryClientProvider>
    )
    expect(screen.getByText('Note approved and sent')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send summary/i })).toBeNull()
  })
})

describe('NoteHistoryModal (B2.5)', () => {
  const version = (id: string, createdAt: string) => ({
    id,
    subjective: null,
    objective: null,
    assessment: `Assessment ${id}`,
    plan: null,
    createdAt,
    createdBy: { name: 'Dr. Synthetic' },
  })

  it('says it is loading rather than "no history" while the versions load', () => {
    render(<NoteHistoryModal isOpen onClose={vi.fn()} versions={[]} isLoading />)
    expect(screen.getByText('Loading versions…')).toBeInTheDocument()
    expect(screen.queryByText('No history available for this note.')).toBeNull()
  })

  it('lists versions newest first and marks the current one', () => {
    render(
      <NoteHistoryModal
        isOpen
        onClose={vi.fn()}
        versions={[version('v1', '2026-10-01T10:00:00Z'), version('v2', '2026-10-02T10:00:00Z')]}
        currentVersionId="v2"
      />
    )
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text.indexOf('Assessment v2')).toBeLessThan(text.indexOf('Assessment v1'))
    expect(text).toMatch(/Version 2\s*Current/)
  })
})

describe('LongitudinalPanel (FR-7)', () => {
  it('lists prior approved visits with what was sent', async () => {
    scribeApi.getLongitudinal.mockResolvedValue([
      {
        visitRecordId: 'v0',
        date: '2026-09-14T10:00:00.000Z',
        assessment: 'Fatigue',
        plan: 'Vitamin D3',
        products: [{ name: 'Vitamin D3', dose: '5000 IU', quantity: 1 }],
      },
    ])
    wrap(<LongitudinalPanel sessionId="sess_1" />)
    expect(await screen.findByText('Sep 14, 2026')).toBeInTheDocument()
    expect(screen.getByText('Vitamin D3 5000 IU × 1')).toBeInTheDocument()
  })

  it('says so on a first visit', async () => {
    scribeApi.getLongitudinal.mockResolvedValue([])
    wrap(<LongitudinalPanel sessionId="sess_1" />)
    expect(await screen.findByText(/First approved visit/)).toBeInTheDocument()
  })
})
