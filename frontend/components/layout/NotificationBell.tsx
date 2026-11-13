'use client'

/**
 * The bell (CTO-30): a red dot when something is unread, and a short list.
 * Today it carries "your appointment starts soon" reminders for providers.
 */
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/notificationsApi'
import { cn } from '@/lib/utils'

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const

export function NotificationBell() {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: getNotifications,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const unread = data?.unread ?? 0
  const items = data?.notifications ?? []

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const refresh = () => void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY })

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="notification-bell"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span
            className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white"
            data-testid="notification-dot"
            aria-hidden
          />
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                onClick={() => void markAllNotificationsRead().then(refresh)}
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-4 text-sm text-slate-500">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.link ?? '/dashboard'}
                    role="menuitem"
                    onClick={() => {
                      setOpen(false)
                      if (!n.readAt) void markNotificationRead(n.id).then(refresh)
                    }}
                    className={cn(
                      'block rounded-xl px-2 py-2 text-sm hover:bg-slate-50',
                      n.readAt ? 'text-slate-500' : 'font-medium text-slate-900'
                    )}
                  >
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
