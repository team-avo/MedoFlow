/** The signed-in user's notifications (CTO-30). PHI-free: a time, a title, a link. */
import api from './api'

export interface AppNotification {
  id: string
  kind: string
  title: string
  link: string | null
  appointmentId: string | null
  startsAt: string | null
  readAt: string | null
  createdAt: string
}

export async function getNotifications(): Promise<{
  notifications: AppNotification[]
  unread: number
}> {
  const { data } = await api.get<{ data: { notifications: AppNotification[]; unread: number } }>(
    '/notifications'
  )
  return data.data
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`, {})
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/notifications/read-all', {})
}

/** Starting-soon reminders that are still ahead (or just started). */
export const startingSoon = (items: AppNotification[], now = Date.now()) =>
  items.filter(
    (n) =>
      n.kind === 'APPOINTMENT_STARTING' &&
      !!n.startsAt &&
      new Date(n.startsAt).getTime() > now - 15 * 60_000
  )
