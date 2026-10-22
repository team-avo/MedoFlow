'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { getAppointmentById, type PatientAppointmentDetail } from '@/lib/patientApi'
import {
  confirmPayment,
  failPayment,
  getOrCreatePaymentIntent,
  demoConfirmPayment,
} from '@/lib/paymentApi'
import { formatDateTime } from '@/lib/timezone'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import { StripePaymentForm } from '@/components/StripePaymentForm'
import { ShippingAddressForm } from '@/components/store/ShippingAddressForm'
import { formatAddress } from '@/components/store/OneClickPay'
import { getOnFile } from '@/lib/rxCartApi'

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder'
)

type PaymentStatus = 'NONE' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED'

type PaymentAppointment = PatientAppointmentDetail & {
  paymentStatus?: PaymentStatus
  bookingHoldExpiresAt?: string | null
  priceAtBooking: string
  service: PatientAppointmentDetail['service'] & { defaultPrice?: string }
}

function formatAmount(amount: string | number | undefined | null) {
  if (amount == null) return '-'
  const num = typeof amount === 'string' ? Number(amount) : amount
  if (Number.isNaN(num)) return '-'
  return num.toFixed(2)
}

export default function PaymentPage() {
  const params = useParams()
  const router = useRouter()
  const appointmentId = params.appointmentId as string

  const {
    data: rawAppointment,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['payment', 'appointment', appointmentId],
    queryFn: () => getAppointmentById(appointmentId) as Promise<PaymentAppointment>,
    enabled: !!appointmentId,
  })

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)

  const appointment = rawAppointment

  const slotExpiry = useMemo(() => {
    if (!appointment?.bookingHoldExpiresAt) return null
    const d = new Date(appointment.bookingHoldExpiresAt)
    return Number.isNaN(d.getTime()) ? null : d
  }, [appointment?.bookingHoldExpiresAt])

  useEffect(() => {
    if (!slotExpiry) return

    const updateRemaining = () => {
      const now = new Date()
      const diffMs = slotExpiry.getTime() - now.getTime()
      setRemainingSeconds(diffMs > 0 ? Math.floor(diffMs / 1000) : 0)
    }

    updateRemaining()
    const id = setInterval(updateRemaining, 1000)
    return () => clearInterval(id)
  }, [slotExpiry])

  const isExpired = remainingSeconds !== null && remainingSeconds <= 0
  const shouldLoadPaymentIntent =
    appointment?.paymentStatus === 'PENDING' &&
    appointment?.status === 'PENDING_PAYMENT' &&
    !isExpired

  const { data: paymentIntent, isLoading: paymentIntentLoading } = useQuery({
    queryKey: ['payment', 'intent', appointmentId],
    queryFn: () => getOrCreatePaymentIntent(appointmentId),
    enabled: !!appointmentId && !!shouldLoadPaymentIntent,
  })

  const confirmMutation = useMutation({
    mutationFn: () => confirmPayment(appointmentId),
    onSuccess: () => {
      router.push(`/intake/${appointmentId}`)
    },
  })

  const demoConfirmMutation = useMutation({
    mutationFn: () => demoConfirmPayment(appointmentId),
    onSuccess: () => {
      router.push(`/intake/${appointmentId}`)
    },
  })

  const failMutation = useMutation({
    mutationFn: () => failPayment(appointmentId),
    onSuccess: () => {
      router.push('/dashboard/appointments')
    },
  })

  const isSubmitting =
    confirmMutation.isPending || failMutation.isPending || demoConfirmMutation.isPending

  // F5.3: the shipping address saved here (and the card paid with below) are
  // what the patient's cart uses for one-click "Pay with card on file".
  const { data: onFile } = useQuery({
    queryKey: ['carts', 'one-click'],
    queryFn: getOnFile,
    enabled: !!appointment,
    retry: false,
  })
  const [editAddress, setEditAddress] = useState(false)

  if (isLoading || !appointment) {
    if (error) {
      return (
        <div className="mx-auto max-w-xl px-4 py-12">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Unable to load payment details. The appointment may be unavailable.
          </div>
          <Link
            href="/dashboard/appointments"
            className="mt-4 inline-block text-sm text-primary-600 hover:text-primary-700"
          >
            ← Back to appointments
          </Link>
        </div>
      )
    }
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    )
  }

  const showExpiredBanner = isExpired || appointment.paymentStatus !== 'PENDING'

  const minutes = remainingSeconds != null ? Math.floor(remainingSeconds / 60) : 0
  const seconds = remainingSeconds != null ? remainingSeconds % 60 : 0

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-2xl flex-col px-4 py-10 sm:px-6">
      <Card className="w-full">
        <CardHeader>
          <h1 className="text-xl font-semibold text-gray-900">Complete your booking</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your slot is reserved for a limited time. Confirm payment to secure your appointment.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="rounded-lg bg-gray-50 p-4 text-sm sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Appointment summary</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Service
                </dt>
                <dd className="mt-1 text-sm text-gray-900">{appointment.service.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Provider
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {appointment.provider.firstName} {appointment.provider.lastName}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Date &amp; time
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {formatDateTime(appointment.startTime)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Amount due
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  ${formatAmount(appointment.priceAtBooking)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-dashed border-primary-200 bg-primary-50/60 p-5 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-primary-700">
              Time remaining to confirm
            </p>
            <p className="mt-3 text-4xl font-semibold tabular-nums text-primary-800 sm:text-5xl">
              {slotExpiry ? (
                <>
                  {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                </>
              ) : (
                '--:--'
              )}
            </p>
            {showExpiredBanner ? (
              appointment.paymentStatus === 'PAID' ? (
                <p className="mt-3 text-sm text-red-700">
                  Payment already completed for this appointment.
                </p>
              ) : (
                // F1.1: an expired reservation is a recoverable state — the
                // slot was released, so send the patient straight back to
                // pick another time (IDs only in the URL).
                <div role="status" data-testid="hold-expired" className="mt-3 space-y-3">
                  <p className="text-sm text-red-700">
                    Your reservation expired and the time was released.
                  </p>
                  <Link
                    href={`/book/${appointment.serviceId}?clinicId=${encodeURIComponent(appointment.clinicId)}`}
                    className="inline-block rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                  >
                    Pick a new time
                  </Link>
                </div>
              )
            ) : (
              <p className="mt-3 text-xs text-primary-700">
                If the timer reaches zero, this slot will be released and you may need to rebook.
              </p>
            )}
          </section>

          {(confirmMutation.error || failMutation.error) && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              There was a problem processing your request. Please try again.
            </div>
          )}

          {!showExpiredBanner && (
            <section
              aria-labelledby="shipping-heading"
              className="rounded-lg border border-gray-200 p-4"
            >
              <h2 id="shipping-heading" className="text-sm font-semibold text-gray-900">
                Shipping address for products your provider prescribes
                <span className="ml-1 font-normal text-gray-500">(optional)</span>
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Saved with the card you pay with today, so prescribed items can be ordered in one
                click — no re-entering details.
              </p>
              <div className="mt-3">
                {onFile?.shippingAddress && !editAddress ? (
                  <p className="text-sm text-gray-700" data-testid="address-on-file">
                    {formatAddress(onFile.shippingAddress)}{' '}
                    <button
                      type="button"
                      onClick={() => setEditAddress(true)}
                      className="ml-2 text-xs font-medium text-primary-700 underline"
                    >
                      Change
                    </button>
                  </p>
                ) : (
                  <ShippingAddressForm
                    initial={onFile?.shippingAddress}
                    onSaved={() => setEditAddress(false)}
                  />
                )}
              </div>
            </section>
          )}

          <div className="flex flex-col gap-3">
            {!showExpiredBanner && paymentIntentLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
              </div>
            ) : !showExpiredBanner && paymentIntent?.clientSecret ? (
              <Elements
                stripe={stripePromise}
                options={{ clientSecret: paymentIntent.clientSecret }}
              >
                <StripePaymentForm
                  clientSecret={paymentIntent.clientSecret}
                  buttonLabel={`Pay $${formatAmount(appointment.priceAtBooking)} & Confirm`}
                  onSuccess={async () => {
                    // Record the payment server-side right away (the webhook
                    // does the same, idempotently); this also keeps the card
                    // on file for one-click purchases.
                    await confirmPayment(appointmentId).catch(() => null)
                    router.push(`/intake/${appointmentId}`)
                  }}
                />
                <p className="mt-2 text-xs text-gray-500">
                  Your card is saved securely with Stripe for one-click purchases of products your
                  provider prescribes. MedoFlow stores only the card brand and last 4 digits.
                </p>
              </Elements>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => router.push('/dashboard/appointments')}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
                >
                  Back to appointments
                </button>
                <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                  <button
                    type="button"
                    onClick={() => failMutation.mutate()}
                    disabled={isSubmitting || showExpiredBanner}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:w-auto"
                  >
                    Cancel payment
                  </button>
                  <button
                    type="button"
                    onClick={() => demoConfirmMutation.mutate()}
                    disabled={isSubmitting || showExpiredBanner}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {demoConfirmMutation.isPending ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Processing...
                      </>
                    ) : (
                      'Demo: Simulate Payment'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmMutation.mutate()}
                    disabled={isSubmitting || showExpiredBanner}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    Confirm & Proceed
                  </button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
