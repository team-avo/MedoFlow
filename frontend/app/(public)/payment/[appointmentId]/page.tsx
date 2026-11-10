'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { AppointmentPayment } from '@/components/booking/AppointmentPayment'

/**
 * Standalone payment page (deep links, "pay now" from the patient's
 * appointments). The booking flow shows the same AppointmentPayment inline as
 * its last step.
 */
export default function PaymentPage() {
  const params = useParams()
  const router = useRouter()
  const appointmentId = params.appointmentId as string

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-2xl flex-col px-4 py-10 sm:px-6">
      <Card className="w-full">
        <CardHeader>
          <h1 className="text-xl font-semibold text-gray-900">Complete your booking</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your slot is reserved for a limited time. Confirm payment to secure your appointment.
          </p>
        </CardHeader>
        <CardContent>
          <AppointmentPayment
            appointmentId={appointmentId}
            onPaid={() => router.push(`/intake/${appointmentId}`)}
            onCancelled={() => router.push('/dashboard/appointments')}
            secondaryAction={{
              label: 'Back to appointments',
              onClick: () => router.push('/dashboard/appointments'),
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
