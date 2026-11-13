'use client'

/**
 * "Your 10:30 appointment starts soon" (CTO-30), on the Command Center and
 * the provider dashboard, with a one-click Start scribe. Same PHI-free
 * reminders as the bell.
 */
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlarmClock, Mic } from 'lucide-react'
import { getNotifications, startingSoon } from '@/lib/notificationsApi'
import { NOTIFICATIONS_QUERY_KEY } from '@/components/layout/NotificationBell'

export function StartingSoonCard() {
  const { data } = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: getNotifications,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const soon = startingSoon(data?.notifications ?? [])
  if (soon.length === 0) return null
  return (
    <section
      aria-label="Starting soon"
      data-testid="starting-soon"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
    >
      <ul className="space-y-2">
        {soon.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-3">
            <AlarmClock className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            <p className="flex-1 text-sm font-semibold text-amber-900">{n.title}</p>
            {n.link && (
              <Link
                href={n.link}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:bg-brand-strong"
              >
                <Mic className="h-3.5 w-3.5" />
                Start scribe
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
