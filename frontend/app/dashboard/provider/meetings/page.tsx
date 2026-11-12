'use client'

/**
 * Google Calendar OAuth callback (CTO-02).
 *
 * The "Video Room" tab that lived here is gone: video and AI Scribe start from
 * the appointment. This URL stays only because it's the redirect URI
 * registered with Google. With `?code`, it finishes the connection and moves
 * on to Appointments; without one, next.config.js redirects straight to
 * /dashboard/appointments, so it's never a dead page.
 */
import React, { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { connectGoogleCalendar } from '@/lib/googleCalendarApi'
import { googleRedirectUri } from '@/components/calendar/GoogleCalendarConnectCard'
import { useAppToast } from '@/hooks/useAppToast'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

function GoogleCallback() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useAppToast()
  const ran = React.useRef(false)

  React.useEffect(() => {
    if (ran.current) return
    ran.current = true
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    if (!code) {
      router.replace('/dashboard/appointments')
      return
    }
    connectGoogleCalendar(code, googleRedirectUri(), state ?? undefined)
      .then(() => toast.success('Google Calendar connected'))
      .catch(() => toast.error('Google Calendar could not be connected. Try again.'))
      .finally(() => router.replace('/dashboard/appointments'))
  }, [searchParams, router, toast])

  return (
    <div className="p-8">
      <LoadingSkeleton variant="card" />
    </div>
  )
}

export default function GoogleCalendarCallbackPage() {
  return (
    <Suspense fallback={null}>
      <GoogleCallback />
    </Suspense>
  )
}
