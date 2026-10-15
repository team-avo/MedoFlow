/** F0.2.1 — idle window maths. */
import { describe, expect, it } from 'vitest'
import { heartbeatDue, idlePhase, idleWindow, secondsLeft } from '@/lib/idleTimeout'

describe('idle window', () => {
  const w = idleWindow(15)

  it('15-minute window: warn for the last 60 s, heartbeat every 5 min', () => {
    expect(w).toEqual({ timeoutMs: 900_000, warningMs: 60_000, heartbeatMs: 300_000 })
  })

  it('phases: active → warning → expired', () => {
    expect(idlePhase(0 + 839_999, 0, w)).toBe('active')
    expect(idlePhase(840_000, 0, w)).toBe('warning')
    expect(idlePhase(899_999, 0, w)).toBe('warning')
    expect(idlePhase(900_000, 0, w)).toBe('expired')
  })

  it('countdown in seconds', () => {
    expect(secondsLeft(840_000, 0, w)).toBe(60)
    expect(secondsLeft(899_001, 0, w)).toBe(1)
    expect(secondsLeft(1_000_000, 0, w)).toBe(0)
  })

  it('short windows never warn for more than half the window', () => {
    expect(idleWindow(1).warningMs).toBe(30_000)
  })

  it('heartbeat only when there was activity since the last one', () => {
    expect(heartbeatDue(300_000, 10, 0, w)).toBe(true)
    expect(heartbeatDue(300_000, 0, 0, w)).toBe(false) // no activity since → idle screen sends nothing
    expect(heartbeatDue(299_999, 10, 0, w)).toBe(false)
  })
})
