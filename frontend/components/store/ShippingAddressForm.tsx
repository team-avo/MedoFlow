'use client'

/**
 * Shipping address for one-click orders (F5.3), saved from the booking
 * payment page and editable from Billing. Same rules as the API.
 */
import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { shippingAddressSchema, type ShippingAddressValues } from '@/lib/schemas/commerce'
import { apiErrorOf, saveShippingAddress, type ShippingAddress } from '@/lib/rxCartApi'

const FIELDS: { name: keyof ShippingAddressValues; label: string; autoComplete: string }[] = [
  { name: 'name', label: 'Full name', autoComplete: 'shipping name' },
  { name: 'line1', label: 'Address line 1', autoComplete: 'shipping address-line1' },
  { name: 'line2', label: 'Address line 2 (optional)', autoComplete: 'shipping address-line2' },
  { name: 'city', label: 'City', autoComplete: 'shipping address-level2' },
  { name: 'state', label: 'State / region', autoComplete: 'shipping address-level1' },
  { name: 'postalCode', label: 'Postal code', autoComplete: 'shipping postal-code' },
  { name: 'country', label: 'Country (2 letters)', autoComplete: 'shipping country' },
]

export function ShippingAddressForm({
  initial,
  onSaved,
  submitLabel = 'Save address',
}: {
  initial?: ShippingAddress | null
  onSaved?: () => void
  submitLabel?: string
}) {
  const queryClient = useQueryClient()
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ShippingAddressValues>({
    resolver: zodResolver(shippingAddressSchema),
    defaultValues: {
      name: initial?.name ?? '',
      line1: initial?.line1 ?? '',
      line2: initial?.line2 ?? '',
      city: initial?.city ?? '',
      state: initial?.state ?? '',
      postalCode: initial?.postalCode ?? '',
      country: initial?.country ?? 'US',
    },
  })

  const submit = handleSubmit(async (values) => {
    setServerError(null)
    setSaved(false)
    try {
      await saveShippingAddress({
        name: values.name,
        line1: values.line1,
        line2: values.line2 ?? undefined,
        city: values.city,
        state: values.state,
        postalCode: values.postalCode,
        country: (values.country ?? 'US').toUpperCase(),
      })
      await queryClient.invalidateQueries({ queryKey: ['carts', 'one-click'] })
      setSaved(true)
      onSaved?.()
    } catch (err) {
      setServerError(apiErrorOf(err).message)
    }
  })

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      aria-label="Shipping address"
    >
      {FIELDS.map((f) => {
        const id = `ship-${f.name}`
        const error = errors[f.name]?.message
        return (
          <div
            key={f.name}
            className={f.name === 'line1' || f.name === 'line2' ? 'sm:col-span-2' : ''}
          >
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
              {f.label}
            </label>
            <input
              id={id}
              autoComplete={f.autoComplete}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
              {...register(f.name)}
            />
            {error && (
              <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">
                {String(error)}
              </p>
            )}
          </div>
        )
      })}
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
        {saved && (
          <span role="status" className="text-xs font-medium text-emerald-700">
            Address saved
          </span>
        )}
        {serverError && (
          <span role="alert" className="text-xs text-red-600">
            {serverError}
          </span>
        )}
      </div>
    </form>
  )
}
