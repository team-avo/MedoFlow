'use client'

import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { AppButton } from '@/components/ui-system'
import { prescriptionFormSchema, LIMITS } from '@/lib/schemas/clinicalRecords'

type PrescriptionFormValues = z.infer<typeof prescriptionFormSchema>

/**
 * New-prescription form (F3.2). Same rules as the API: notes are required
 * (whitespace does not count) and at most LIMITS.prescriptionNotesMax
 * characters — invalid input never reaches the network.
 */
export function PrescriptionForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
}: {
  onSubmit: (notes: string) => void
  onCancel: () => void
  isSubmitting?: boolean
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PrescriptionFormValues>({
    resolver: zodResolver(prescriptionFormSchema),
    defaultValues: { notes: '' },
  })

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(values.notes))}
      className="p-6 bg-slate-50 rounded-3xl border-2 border-primary-100 animate-in space-y-4"
      noValidate
    >
      <label htmlFor="prescription-notes" className="sr-only">
        Prescription
      </label>
      <textarea
        id="prescription-notes"
        className="w-full bg-white rounded-2xl p-4 text-sm border-slate-200 outline-none focus:border-primary-600"
        rows={4}
        maxLength={LIMITS.prescriptionNotesMax + 1}
        placeholder="Enter medication, dosage, and instructions..."
        aria-invalid={!!errors.notes}
        aria-describedby={errors.notes ? 'prescription-notes-error' : undefined}
        {...register('notes')}
      />
      {errors.notes && (
        <p id="prescription-notes-error" role="alert" className="text-sm text-red-600">
          {errors.notes.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <AppButton type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </AppButton>
        <AppButton type="submit" size="sm" className="rounded-full px-6" disabled={isSubmitting}>
          Save Prescription
        </AppButton>
      </div>
    </form>
  )
}
