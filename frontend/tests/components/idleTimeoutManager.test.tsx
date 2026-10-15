/** F0.2.1 — idle warning, then sign-out; "Stay signed in" and heartbeats. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const get = vi.fn().mockResolvedValue({ data: {} })
vi.mock('@/lib/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }))

import { IdleTimeoutManager } from '@/components/auth/IdleTimeoutManager'

beforeEach(() => {
  vi.useFakeTimers()
  get.mockClear()
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

describe('IdleTimeoutManager', () => {
  it('warns one minute before the window ends, then signs out', async () => {
    const onTimeout = vi.fn()
    render(<IdleTimeoutManager timeoutMinutes={15} onTimeout={onTimeout} />)

    await advance(13 * 60_000 + 59_000)
    expect(screen.queryByTestId('idle-warning')).not.toBeInTheDocument()

    await advance(2_000)
    expect(screen.getByTestId('idle-warning')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Are you still there?')
    expect(screen.getByTestId('idle-countdown')).toHaveTextContent(/^\d+s$/)
    expect(screen.getByRole('button', { name: 'Stay signed in' })).toHaveFocus()
    expect(onTimeout).not.toHaveBeenCalled()

    // Moving the mouse while warned does not silently extend the session.
    fireEvent.mouseMove(window)
    await advance(60_000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('"Stay signed in" resets the window and pings the server session', async () => {
    const onTimeout = vi.fn()
    render(<IdleTimeoutManager timeoutMinutes={15} onTimeout={onTimeout} />)
    await advance(14 * 60_000 + 5_000)
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
    expect(get).toHaveBeenCalledWith('/auth/session')
    await advance(1_000)
    expect(screen.queryByTestId('idle-warning')).not.toBeInTheDocument()
    await advance(13 * 60_000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('activity keeps the session alive and sends heartbeats; an idle screen sends none', async () => {
    const onTimeout = vi.fn()
    render(<IdleTimeoutManager timeoutMinutes={15} onTimeout={onTimeout} />)
    // Work (keyboard) for 20 minutes without any API call.
    for (let i = 0; i < 20; i++) {
      await advance(60_000)
      fireEvent.keyDown(window, { key: 'a' })
    }
    expect(onTimeout).not.toHaveBeenCalled()
    expect(get.mock.calls.filter(([p]) => p === '/auth/session').length).toBeGreaterThanOrEqual(3)

    const before = get.mock.calls.length
    await advance(10 * 60_000)
    // No input during these 10 minutes: at most the one heartbeat owed for the last activity.
    expect(get.mock.calls.length - before).toBeLessThanOrEqual(1)
  })

  it('activity in another tab (storage event) counts', async () => {
    const onTimeout = vi.fn()
    render(<IdleTimeoutManager timeoutMinutes={15} onTimeout={onTimeout} />)
    await advance(14 * 60_000)
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'medoflow:last-activity', newValue: String(Date.now()) })
      )
    })
    await advance(10 * 60_000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('"Sign out now" signs out immediately', async () => {
    const onTimeout = vi.fn()
    render(<IdleTimeoutManager timeoutMinutes={15} onTimeout={onTimeout} />)
    await advance(14 * 60_000 + 1_000)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out now' }))
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })
})
