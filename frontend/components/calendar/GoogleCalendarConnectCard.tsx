'use client'

/**
 * Connect or disconnect a provider's Google Calendar (CTO-02). The old
 * "Video Room" tab is gone, but the calendar connection keeps working from
 * the provider's profile (and later from onboarding, CTO-37). Google sends
 * the provider back to /dashboard/provider/meetings, the redirect URI
 * registered with Google, which finishes the connection.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays } from 'lucide-react'
import {
  disconnectGoogleCalendar,
  getGoogleAuthUrl,
  getGoogleConnectionStatus,
} from '@/lib/googleCalendarApi'

/** The OAuth redirect URI registered with Google. Kept stable on purpose. */
export const GOOGLE_CALLBACK_PATH = '/dashboard/provider/meetings'

export const googleRedirectUri = () =>
  typeof window !== 'undefined' ? `${window.location.origin}${GOOGLE_CALLBACK_PATH}` : ''

export function GoogleCalendarConnectCard() {
  const queryClient = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['google-meetings-status'],
    queryFn: getGoogleConnectionStatus,
  })
  const connect = useMutation({
    mutationFn: async () => {
      window.location.href = await getGoogleAuthUrl(googleRedirectUri())
    },
  })
  const disconnect = useMutation({
    mutationFn: disconnectGoogleCalendar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['google-meetings-status'] }),
  })
  const connected = !!status?.connected

  return (
    <section
      className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
      aria-label="Google Calendar"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
            <CalendarDays className="h-4 w-4 text-slate-600" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Google Calendar</h2>
            <p className="text-xs text-slate-500">
              {isLoading
                ? 'Checking the connection…'
                : connected
                  ? 'Connected. Your MedoFlow appointments stay in step with your calendar.'
                  : 'Not connected.'}
            </p>
          </div>
        </div>
        {connected ? (
          <button
            type="button"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => connect.mutate()}
            disabled={connect.isPending || isLoading}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground hover:bg-brand-strong disabled:opacity-50"
          >
            Connect Google Calendar
          </button>
        )}
      </div>
    </section>
  )
}
