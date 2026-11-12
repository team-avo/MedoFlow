/**
 * The consult room keeps the appointment it loaded when a consent or
 * recording response leaves it out, so an in-person visit never turns into
 * a video call (found by the live fresh-clinic run, CTO-23 / CTO-30).
 */
import { describe, expect, it } from 'vitest'
import { withSessionContext, type ConsultationSession } from '@/lib/consultationApi'

const base = {
  id: 's1',
  consentStatus: 'PENDING',
  recordingStatus: 'NOT_STARTED',
  appointment: { id: 'a1', startTime: 't0', endTime: 't1', mode: 'IN_PERSON' as const },
  provider: { id: 'p1', firstName: 'Khush', lastName: 'Owner' },
  patient: { id: 'pt1', name: 'Walk In' },
} as unknown as ConsultationSession

describe('withSessionContext', () => {
  it('keeps the appointment, provider and patient a bare response leaves out', () => {
    const bare = { ...base, consentStatus: 'GRANTED' } as ConsultationSession
    delete (bare as Partial<ConsultationSession>).appointment
    delete (bare as Partial<ConsultationSession>).provider
    delete (bare as Partial<ConsultationSession>).patient
    const next = withSessionContext(base, bare)!
    expect(next.consentStatus).toBe('GRANTED')
    expect(next.appointment?.mode).toBe('IN_PERSON')
    expect(next.provider).toEqual(base.provider)
    expect(next.patient).toEqual(base.patient)
  })

  it('a response with fewer appointment fields keeps the mode it lacks', () => {
    const partial = { ...base, appointment: { id: 'a1', startTime: 't0', endTime: 't2' } }
    const next = withSessionContext(base, partial as ConsultationSession)!
    expect(next.appointment).toMatchObject({ endTime: 't2', mode: 'IN_PERSON' })
  })

  it('takes a different session, or a reset, as it is', () => {
    const other = { ...base, id: 's2', appointment: undefined } as ConsultationSession
    expect(withSessionContext(base, other)).toBe(other)
    expect(withSessionContext(base, null)).toBeNull()
    expect(withSessionContext(null, base)).toBe(base)
  })
})
