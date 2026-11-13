/** CTO-35: when an idle call asks, and when it ends. */
import { describe, expect, it } from 'vitest'
import { idleCallPhase, promptSecondsLeft } from '@/lib/idleCall'

describe('idleCallPhase', () => {
  const t0 = 1_000_000
  it('is fine while others are in the call', () => {
    expect(
      idleCallPhase(t0 + 10 * 60_000, { aloneSince: null, lastActivity: t0 }, 60_000, 30_000)
    ).toBe('ok')
  })
  it('asks after the alone window and ends after the prompt', () => {
    const s = { aloneSince: t0, lastActivity: t0 - 5_000 }
    expect(idleCallPhase(t0 + 59_999, s, 60_000, 30_000)).toBe('ok')
    expect(idleCallPhase(t0 + 60_000, s, 60_000, 30_000)).toBe('prompt')
    expect(promptSecondsLeft(t0 + 61_000, s, 60_000, 30_000)).toBe(29)
    expect(idleCallPhase(t0 + 90_000, s, 60_000, 30_000)).toBe('end')
  })
  it('activity after the room emptied restarts the clock', () => {
    expect(
      idleCallPhase(t0 + 90_000, { aloneSince: t0, lastActivity: t0 + 40_000 }, 60_000, 30_000)
    ).toBe('ok')
  })
})
