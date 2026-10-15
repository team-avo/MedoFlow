'use client'

import React, { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { addToWaitlist } from '@/lib/waitlistApi'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'

const waitlistSchema = z
  .object({
    preferredDate: z.string().min(1, 'Date is required'),
    preferredStartTime: z.string().min(1, 'Start time is required'),
    preferredEndTime: z.string().min(1, 'End time is required'),
  })
  .refine((data) => data.preferredEndTime > data.preferredStartTime, {
    message: 'End time must be after start time',
    path: ['preferredEndTime'],
  })

type WaitlistFormData = z.infer<typeof waitlistSchema>

interface WaitlistModalProps {
  isOpen: boolean
  onClose: () => void
  clinicId: string
  providerId: string
  serviceId: string
  locationId?: string
  timezone?: string
  defaultPreferredDate?: string
  onSuccess?: () => void
}

export function WaitlistModal({
  isOpen,
  onClose,
  clinicId,
  providerId,
  serviceId,
  locationId,
  timezone,
  defaultPreferredDate = '',
  onSuccess,
}: WaitlistModalProps) {
  const { isAuthenticated, user } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<WaitlistFormData>({
    resolver: zodResolver(waitlistSchema),
    defaultValues: {
      preferredDate: defaultPreferredDate,
      preferredStartTime: '09:00',
      preferredEndTime: '17:00',
    },
  })

  useEffect(() => {
    if (isOpen && defaultPreferredDate) {
      setValue('preferredDate', defaultPreferredDate)
    }
  }, [isOpen, defaultPreferredDate, setValue])

  const mutation = useMutation({
    mutationFn: (data: WaitlistFormData) =>
      addToWaitlist({
        clinicId,
        providerId,
        serviceId,
        locationId,
        timezone,
        preferredDate: data.preferredDate,
        preferredStartTime: data.preferredStartTime,
        preferredEndTime: data.preferredEndTime,
      }),
    onSuccess: () => {
      reset()
      setError(null)
      onSuccess?.()
      onClose()
    },
    onError: (err: { response?: { data?: { message?: string }; status?: number } }) => {
      setError(err.response?.data?.message ?? 'Failed to join waitlist. Please try again.')
    },
  })

  if (!isOpen) return null

  const handleClose = () => {
    setError(null)
    reset()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="waitlist-title"
        className="w-full max-w-md"
      >
        <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200">
          <h2 id="waitlist-title" className="text-lg font-semibold text-gray-900">
            Join waitlist
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </CardHeader>
        <CardContent className="pt-4">
          {!isAuthenticated || !user ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Please sign in to join the waitlist for this service.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </div>
              )}
              <div>
                <label
                  htmlFor="waitlist-preferredDate"
                  className="block text-sm font-medium text-gray-700"
                >
                  Preferred date
                </label>
                <input
                  id="waitlist-preferredDate"
                  {...register('preferredDate')}
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {errors.preferredDate && (
                  <p className="mt-1 text-sm text-red-600">{errors.preferredDate.message}</p>
                )}
              </div>
              <div>
                <label
                  htmlFor="waitlist-preferredStartTime"
                  className="block text-sm font-medium text-gray-700"
                >
                  Preferred start time
                </label>
                <input
                  id="waitlist-preferredStartTime"
                  {...register('preferredStartTime')}
                  type="time"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {errors.preferredStartTime && (
                  <p className="mt-1 text-sm text-red-600">{errors.preferredStartTime.message}</p>
                )}
              </div>
              <div>
                <label
                  htmlFor="waitlist-preferredEndTime"
                  className="block text-sm font-medium text-gray-700"
                >
                  Preferred end time
                </label>
                <input
                  id="waitlist-preferredEndTime"
                  {...register('preferredEndTime')}
                  type="time"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {errors.preferredEndTime && (
                  <p className="mt-1 text-sm text-red-600">{errors.preferredEndTime.message}</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutation.isPending}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {mutation.isPending ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Joining...
                    </>
                  ) : (
                    'Join waitlist'
                  )}
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
