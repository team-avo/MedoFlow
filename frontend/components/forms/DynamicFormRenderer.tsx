'use client'

import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import type { FormTemplate, FormFieldDefinition } from '@/lib/formsApi'
import { submitFormResponse } from '@/lib/formsApi'
import {
  answeredYes,
  buildAnswersSchema,
  FOLLOW_UP_SUFFIX,
  type FollowUpAnswer,
} from '@/lib/schemas/clinicalRecords'
import { extractApiError } from '@/lib/apiErrors'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'

interface DynamicFormRendererProps {
  template: FormTemplate
  patientId: string
  appointmentId: string
  onComplete: () => void
}

export function DynamicFormRenderer({
  template,
  patientId,
  appointmentId,
  onComplete,
}: DynamicFormRendererProps) {
  const schema = React.useMemo(
    () => buildAnswersSchema((template.fields as FormFieldDefinition[]) ?? []),
    [template.fields]
  )

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(
      ((template.fields as FormFieldDefinition[]) ?? []).map((f) => {
        if (f.type === 'checkbox') return [f.id, false]
        if (f.type === 'number') return [f.id, undefined]
        return [f.id, '']
      })
    ),
  })

  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const values = watch() as Record<string, unknown>

  // CTO-21: a follow-up only exists while its question is answered Yes.
  React.useEffect(() => {
    for (const f of (template.fields as FormFieldDefinition[]) ?? []) {
      const key = `${f.id}${FOLLOW_UP_SUFFIX}`
      if (f.followUp && !answeredYes(f, values[f.id]) && values[key]) {
        setValue(key, undefined)
      }
    }
  }, [values, template.fields, setValue])

  const onSubmit = async (values: Record<string, unknown>) => {
    setSubmitError(null)
    try {
      await submitFormResponse({
        templateId: template.id,
        patientId,
        appointmentId,
        responses: values,
      })
      onComplete()
    } catch (err) {
      setSubmitError(extractApiError(err, 'Failed to submit form. Please try again.').message)
    }
  }

  const fields = (template.fields as FormFieldDefinition[]) ?? []

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <h2 className="text-xl font-semibold text-gray-900">{template.name}</h2>
        {template.description && (
          <p className="mt-1 text-sm text-gray-500">{template.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          {fields.map((field) => (
            <div key={field.id}>
              {field.type === 'text' && (
                <>
                  <label
                    htmlFor={field.id}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    {field.label}
                    {field.required && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    id={field.id}
                    type="text"
                    placeholder={field.placeholder}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    {...register(field.id)}
                  />
                </>
              )}
              {field.type === 'textarea' && (
                <>
                  <label
                    htmlFor={field.id}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    {field.label}
                    {field.required && <span className="text-red-500"> *</span>}
                  </label>
                  <textarea
                    id={field.id}
                    rows={4}
                    placeholder={field.placeholder}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    {...register(field.id)}
                  />
                </>
              )}
              {field.type === 'number' && (
                <>
                  <label
                    htmlFor={field.id}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    {field.label}
                    {field.required && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    id={field.id}
                    type="number"
                    placeholder={field.placeholder}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    {...register(field.id, { valueAsNumber: true })}
                  />
                </>
              )}
              {field.type === 'checkbox' && (
                <div className="flex items-center gap-2">
                  <input
                    id={field.id}
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    {...register(field.id)}
                  />
                  <label htmlFor={field.id} className="text-sm font-medium text-gray-700">
                    {field.label}
                    {field.required && <span className="text-red-500"> *</span>}
                  </label>
                </div>
              )}
              {field.type === 'select' && (
                <>
                  <label
                    htmlFor={field.id}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    {field.label}
                    {field.required && <span className="text-red-500"> *</span>}
                  </label>
                  <select
                    id={field.id}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    {...register(field.id)}
                  >
                    <option value="">Select...</option>
                    {(field.options ?? []).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {errors[field.id] && (
                <p className="mt-1 text-xs text-red-600">
                  {(errors as Record<string, { message?: string }>)[field.id]?.message}
                </p>
              )}

              {field.followUp && answeredYes(field, values[field.id]) && (
                <FollowUpQuestion
                  field={field}
                  value={values[`${field.id}${FOLLOW_UP_SUFFIX}`] as FollowUpAnswer | undefined}
                  onChange={(v) =>
                    setValue(`${field.id}${FOLLOW_UP_SUFFIX}`, v, { shouldValidate: isSubmitted })
                  }
                  error={
                    (errors as Record<string, { message?: string }>)[
                      `${field.id}${FOLLOW_UP_SUFFIX}`
                    ]?.message
                  }
                />
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Submitting...
              </span>
            ) : (
              'Submit'
            )}
          </button>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * "Which ones?" for a yes/no question answered Yes (CTO-21): tick any listed
 * option and, when allowed, type others.
 */
function FollowUpQuestion({
  field,
  value,
  onChange,
  error,
}: {
  field: FormFieldDefinition
  value: FollowUpAnswer | undefined
  onChange: (v: FollowUpAnswer) => void
  error?: string
}) {
  const fu = field.followUp!
  const selected = value?.selected ?? []
  const other = value?.other ?? ''
  const [otherOn, setOtherOn] = React.useState(other.length > 0)
  const toggle = (v: string, on: boolean) =>
    onChange({
      selected: on ? [...selected, v] : selected.filter((s) => s !== v),
      ...(otherOn ? { other } : {}),
    })
  return (
    <fieldset
      className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3"
      data-testid={`followup-${field.id}`}
    >
      <legend className="px-1 text-sm font-medium text-gray-700">
        {fu.label}
        {fu.required !== false && <span className="text-red-500"> *</span>}
      </legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {fu.options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={selected.includes(o.value)}
              onChange={(e) => toggle(o.value, e.target.checked)}
            />
            {o.label}
          </label>
        ))}
        {fu.allowOther && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={otherOn}
              onChange={(e) => {
                setOtherOn(e.target.checked)
                onChange({ selected, ...(e.target.checked ? { other } : {}) })
              }}
            />
            Other
          </label>
        )}
      </div>
      {fu.allowOther && otherOn && (
        <input
          type="text"
          aria-label={`${fu.label}: other`}
          placeholder="Please describe"
          maxLength={2000}
          value={other}
          onChange={(e) => onChange({ selected, other: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </fieldset>
  )
}
