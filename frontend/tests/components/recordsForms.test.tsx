/**
 * F3.2 — records forms block invalid input client-side (same rules as the
 * API) and submit valid input: prescription form, treatment-plan modal,
 * intake form renderer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'PROVIDER', clinicId: 'c1' } }),
}))
vi.mock('@/lib/disciplineApi', () => ({
  getDisciplines: vi.fn(async () => [{ id: 'd1', name: 'Physio' }]),
}))
vi.mock('@/lib/availabilityApi', () => ({ listProviders: vi.fn(async () => []) }))
const planApi = vi.hoisted(() => ({
  createTreatmentPlan: vi.fn(),
  updateTreatmentPlan: vi.fn(),
  completeTreatmentPlan: vi.fn(),
}))
vi.mock('@/lib/treatmentPlanApi', () => planApi)
const formsApi = vi.hoisted(() => ({ submitFormResponse: vi.fn() }))
vi.mock('@/lib/formsApi', () => formsApi)

import { PrescriptionForm } from '@/components/records/PrescriptionForm'
import { CreatePlanModal } from '@/components/CreatePlanModal'
import { DynamicFormRenderer } from '@/components/forms/DynamicFormRenderer'

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  )

beforeEach(() => vi.clearAllMocks())

describe('PrescriptionForm', () => {
  it('blocks blank notes, then submits valid notes', async () => {
    const onSubmit = vi.fn()
    render(<PrescriptionForm onSubmit={onSubmit} onCancel={() => undefined} />)
    fireEvent.change(screen.getByLabelText('Prescription'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Prescription' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Prescription notes are required')
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Prescription'), {
      target: { value: 'Synthetic: vitamin D daily' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Prescription' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Synthetic: vitamin D daily'))
  })

  it('blocks notes over the API limit', async () => {
    const onSubmit = vi.fn()
    render(<PrescriptionForm onSubmit={onSubmit} onCancel={() => undefined} />)
    fireEvent.change(screen.getByLabelText('Prescription'), { target: { value: 'x'.repeat(5001) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Prescription' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('At most 5000 characters')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('CreatePlanModal', () => {
  const renderModal = () =>
    wrap(
      <CreatePlanModal
        isOpen
        onClose={() => undefined}
        patientId="p1"
        providerId="pr1"
        clinicId="c1"
      />
    )

  it('blocks an invalid plan (no name, zero sessions, end before start) with no request', async () => {
    const { container } = renderModal()
    const sessions = container.querySelector('input[name="totalSessions"]')!
    fireEvent.change(sessions, { target: { value: '0' } })
    fireEvent.change(container.querySelector('input[name="endDate"]')!, {
      target: { value: '2000-01-01' },
    })
    fireEvent.submit(container.querySelector('form')!)
    expect(await screen.findByText('Plan name is required')).toBeInTheDocument()
    expect(screen.getByText('At least 1 session required')).toBeInTheDocument()
    expect(planApi.createTreatmentPlan).not.toHaveBeenCalled()
  })

  it('submits a valid plan with the API payload shape', async () => {
    planApi.createTreatmentPlan.mockResolvedValue({ id: 'tp1' })
    const { container } = renderModal()
    await screen.findByRole('option', { name: 'Physio' })
    fireEvent.change(container.querySelector('input[name="name"]')!, {
      target: { value: 'Synthetic knee plan' },
    })
    fireEvent.change(container.querySelector('select[name="disciplineId"]')!, {
      target: { value: 'd1' },
    })
    fireEvent.change(container.querySelector('input[name="totalSessions"]')!, {
      target: { value: '6' },
    })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(planApi.createTreatmentPlan).toHaveBeenCalled())
    expect(planApi.createTreatmentPlan.mock.calls[0]![0]).toMatchObject({
      patientId: 'p1',
      providerId: 'pr1',
      disciplineId: 'd1',
      name: 'Synthetic knee plan',
      totalSessions: 6,
    })
  })
})

describe('DynamicFormRenderer (intake)', () => {
  const template = {
    id: 't1',
    clinicId: 'c1',
    name: 'Synthetic intake',
    description: null,
    scope: 'CLINIC' as const,
    isActive: true,
    createdAt: '',
    fields: [
      { id: 'reason', type: 'text' as const, label: 'Reason', required: true },
      { id: 'age', type: 'number' as const, label: 'Age' },
      { id: 'consent', type: 'checkbox' as const, label: 'I consent', required: true },
    ],
  }

  it('blocks a blank required answer and an unticked required checkbox', async () => {
    render(
      <DynamicFormRenderer
        template={template}
        patientId="p1"
        appointmentId="a1"
        onComplete={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(2))
    expect(formsApi.submitFormResponse).not.toHaveBeenCalled()
  })

  it('submits valid answers (blank optional number omitted)', async () => {
    formsApi.submitFormResponse.mockResolvedValue({})
    const onComplete = vi.fn()
    render(
      <DynamicFormRenderer
        template={template}
        patientId="p1"
        appointmentId="a1"
        onComplete={onComplete}
      />
    )
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Synthetic knee pain' } })
    fireEvent.click(screen.getByLabelText(/I consent/))
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(formsApi.submitFormResponse.mock.calls[0]![0].responses).toEqual({
      reason: 'Synthetic knee pain',
      age: undefined,
      consent: true,
    })
  })
})
