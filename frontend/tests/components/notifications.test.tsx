/** CTO-30: the bell's red dot and the "starting soon" card. */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
const getNotifications = vi.fn()
vi.mock('@/lib/notificationsApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/notificationsApi')>()),
  getNotifications: () => getNotifications(),
}))

import { NotificationBell } from '@/components/layout/NotificationBell'
import { StartingSoonCard } from '@/components/dashboard/StartingSoonCard'
import { startingSoon, type AppNotification } from '@/lib/notificationsApi'

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  )

const soon = (minutes: number, read = false): AppNotification => ({
  id: `n${minutes}`,
  kind: 'APPOINTMENT_STARTING',
  title: 'Your 10:30 AM appointment starts soon',
  link: '/dashboard/provider/appointments/a1/consultation?autostart=1',
  appointmentId: 'a1',
  startsAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  readAt: read ? new Date().toISOString() : null,
  createdAt: new Date().toISOString(),
})

describe('notifications', () => {
  it('the bell shows a red dot while something is unread', async () => {
    getNotifications.mockResolvedValue({ notifications: [soon(5)], unread: 1 })
    wrap(<NotificationBell />)
    expect(await screen.findByTestId('notification-dot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })

  it('no dot when everything is read', async () => {
    getNotifications.mockResolvedValue({ notifications: [soon(5, true)], unread: 0 })
    wrap(<NotificationBell />)
    await screen.findByRole('button', { name: 'Notifications' })
    expect(screen.queryByTestId('notification-dot')).toBeNull()
  })

  it('the card offers Start scribe for an appointment starting soon', async () => {
    getNotifications.mockResolvedValue({ notifications: [soon(5)], unread: 1 })
    wrap(<StartingSoonCard />)
    const link = await screen.findByRole('link', { name: /Start scribe/ })
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/provider/appointments/a1/consultation?autostart=1'
    )
    expect(screen.getByText('Your 10:30 AM appointment starts soon')).toBeInTheDocument()
  })

  it('old reminders drop off the card', () => {
    expect(startingSoon([soon(-30), soon(5)]).map((n) => n.id)).toEqual(['n5'])
  })
})
