/** CTO-21: "Which conditions?" appears when the answer is Yes, is required, and staff see it. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { FormFieldDefinition, FormTemplate } from '@/lib/formsApi'

const submitFormResponse = vi.fn().mockResolvedValue({})
vi.mock('@/lib/formsApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/formsApi')>()),
  submitFormResponse: (...a: unknown[]) => submitFormResponse(...a),
}))

import { DynamicFormRenderer } from '@/components/forms/DynamicFormRenderer'
import { IntakeFormsSection } from '@/components/intake/IntakeFormsSection'

const conditions: FormFieldDefinition = {
  id: 'existingConditions',
  type: 'select',
  label: 'Do you have any existing medical conditions?',
  required: true,
  options: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ],
  followUp: {
    label: 'Which conditions?',
    required: true,
    allowOther: true,
    options: [
      { value: 'diabetes', label: 'Diabetes' },
      { value: 'hypertension', label: 'High blood pressure' },
    ],
  },
}

const template = {
  id: 'tpl-1',
  name: 'Patient intake',
  description: null,
  scope: 'CLINIC',
  fields: [conditions],
  isActive: true,
  createdAt: '2026-11-12T00:00:00.000Z',
} as unknown as FormTemplate

describe('intake follow-up', () => {
  it('asks which conditions only on Yes, requires an answer, and sends it', async () => {
    const onComplete = vi.fn()
    render(
      <DynamicFormRenderer
        template={template}
        patientId="p"
        appointmentId="a"
        onComplete={onComplete}
      />
    )
    expect(screen.queryByTestId('followup-existingConditions')).toBeNull()
    fireEvent.change(screen.getByLabelText(/existing medical conditions/), {
      target: { value: 'yes' },
    })
    expect(await screen.findByTestId('followup-existingConditions')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Tell us which')).toBeInTheDocument()
    expect(submitFormResponse).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Diabetes'))
    fireEvent.click(screen.getByLabelText('Other'))
    fireEvent.change(screen.getByLabelText('Which conditions?: other'), {
      target: { value: 'Synthetic gout' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(submitFormResponse.mock.calls[0]![0]).toMatchObject({
      responses: {
        existingConditions: 'yes',
        existingConditions__followUp: { selected: ['diabetes'], other: 'Synthetic gout' },
      },
    })
  })

  it('answering No removes the follow-up', async () => {
    render(
      <DynamicFormRenderer
        template={template}
        patientId="p"
        appointmentId="a"
        onComplete={vi.fn()}
      />
    )
    const q = screen.getByLabelText(/existing medical conditions/)
    fireEvent.change(q, { target: { value: 'yes' } })
    fireEvent.click(await screen.findByLabelText('Diabetes'))
    fireEvent.change(q, { target: { value: 'no' } })
    await waitFor(() => expect(screen.queryByTestId('followup-existingConditions')).toBeNull())
  })

  it('staff see the selected conditions under the follow-up question', () => {
    render(
      <IntakeFormsSection
        appointmentId="a"
        responses={[
          {
            id: 'r1',
            appointmentId: 'a',
            createdAt: '2026-11-12T00:00:00.000Z',
            template: { id: 'tpl-1', name: 'Patient intake', fields: [conditions] },
            responses: {
              existingConditions: 'yes',
              existingConditions__followUp: { selected: ['hypertension'], other: 'Gout' },
            },
          } as never,
        ]}
      />
    )
    fireEvent.click(screen.getByText('Patient intake'))
    expect(screen.getByText('Which conditions?')).toBeInTheDocument()
    expect(screen.getByText('High blood pressure')).toBeInTheDocument()
    expect(screen.getByText('Other: Gout')).toBeInTheDocument()
  })
})
