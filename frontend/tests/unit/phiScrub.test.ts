/**
 * F0.3.2 — no PHI reaches the browser console; F0.3.3 — the same scrubber
 * is what any future telemetry SDK's beforeSend must call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { describeError, scrubPhi, scrubText } from '@/lib/phiScrub'
import { clientLog } from '@/lib/clientLog'

const PHI = {
  name: 'Jane Synthetic',
  email: 'jane.synthetic@example.test',
  phone: '555-010-1234',
  transcript: 'Patient reports chest pain since Tuesday',
  dob: '1980-02-03',
}

function axiosErrorWithPhi() {
  const config = {
    url: '/patients',
    method: 'post',
    data: JSON.stringify({ name: PHI.name, email: PHI.email }),
    headers: new AxiosHeaders({ Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig' }),
  }
  return new AxiosError(
    'Request failed with status code 422',
    'ERR_BAD_REQUEST',
    config as never,
    null,
    {
      status: 422,
      statusText: 'Unprocessable',
      headers: {},
      config: config as never,
      data: {
        code: 'validation_failed',
        message: `bad input for ${PHI.email}`,
        transcript: PHI.transcript,
      },
    }
  )
}

const containsPhi = (text: string) =>
  [PHI.name, PHI.email, PHI.phone, PHI.transcript, 'eyJhbGciOiJIUzI1NiJ9'].some((v) =>
    text.includes(v)
  )

afterEach(() => vi.restoreAllMocks())

describe('scrubText', () => {
  it('masks emails, phone numbers, JWTs, SSNs and card numbers', () => {
    const out = scrubText(
      `mail ${PHI.email} call ${PHI.phone} ssn 123-45-6789 card 4242 4242 4242 4242 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc`
    )
    expect(out).not.toContain(PHI.email)
    expect(out).not.toContain(PHI.phone)
    expect(out).not.toContain('123-45-6789')
    expect(out).not.toContain('4242 4242')
    expect(out).toContain('[EMAIL]')
    expect(out).toContain('[JWT]')
  })
})

describe('scrubPhi (deep, key-based)', () => {
  it('redacts PHI keys at any depth and keeps ids', () => {
    const out = scrubPhi({
      id: 'ckabc123',
      patient: { ...PHI, id: 'ckpat1' },
      items: [{ notes: 'x' }],
    })
    const text = JSON.stringify(out)
    expect(containsPhi(text)).toBe(false)
    expect(text).toContain('ckabc123')
    expect(text).toContain('ckpat1')
  })

  it('never throws on cycles', () => {
    const a: Record<string, unknown> = { id: 'x' }
    a.self = a
    expect(() => scrubPhi(a)).not.toThrow()
  })
})

describe('describeError / clientLog', () => {
  it('reduces an Axios error (request body, auth header, response body) to status + code', () => {
    const summary = describeError(axiosErrorWithPhi())
    expect(summary).toMatchObject({ status: 422, code: 'validation_failed' })
    expect(containsPhi(JSON.stringify(summary))).toBe(false)
  })

  it('clientLog.error never prints PHI from the error or the context string', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    clientLog.error(`saving patient ${PHI.email} failed`, axiosErrorWithPhi())
    clientLog.error('plain error', new Error(`boom for ${PHI.email} at ${PHI.phone}`))
    const printed = JSON.stringify(spy.mock.calls)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(containsPhi(printed)).toBe(false)
  })
})

describe('telemetry hook contract (F0.3.3)', () => {
  it('an analytics/monitoring event passed through scrubPhi carries no PHI', () => {
    const event = {
      event: 'visit_viewed',
      user: { id: 'u1', email: PHI.email, name: PHI.name },
      extra: { url: '/dashboard/patients/ckpat1', note: PHI.transcript },
      breadcrumbs: [{ message: `opened chart for ${PHI.email}` }],
    }
    expect(containsPhi(JSON.stringify(scrubPhi(event)))).toBe(false)
  })
})
