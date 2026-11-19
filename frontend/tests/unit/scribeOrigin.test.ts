/** CTO-30/39: every "Start scribe" link says where it came from (usage analytics). */
import { describe, expect, it } from 'vitest'
import { scribeHref } from '@/components/dashboard/TodayAppointmentsCard'

describe('scribeHref', () => {
  it('defaults to the Command Center and keeps autostart', () => {
    expect(scribeHref('a1')).toBe(
      '/dashboard/provider/appointments/a1/consultation?autostart=1&from=command_center'
    )
  })

  it('names the Appointments list when asked', () => {
    expect(scribeHref('a1', 'appointments_list')).toMatch(/[?&]from=appointments_list$/)
  })
})
