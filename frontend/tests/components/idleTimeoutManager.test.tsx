/** F0.2.1: idle warning, then sign-out; "Stay signed in" and heartbeats. */
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

describe('CTO-13: onboarding forms', () => {
  const answer = (minutes: number) => ({
    data: { data: { session: { idleTimeoutMinutes: minutes } } },
  })

  it('typing for 45 minutes keeps the owner signed in; the server window is mirrored', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(answer(url.includes('context=onboarding') ? 60 : 15))
    )
    const onTimeout = vi.fn()
    render(<IdleTimeoutManager timeoutMinutes={15} onTimeout={onTimeout} context="onboarding" />)
    // Entering onboarding tells the server at once.
    expect(get).toHaveBeenCalledWith('/auth/session?context=onboarding')
    // Type into a form field (an `input` event, as real typing / autofill fires).
    const field = document.createElement('input')
    document.body.appendChild(field)
    for (let i = 0; i < 45; i++) {
      fireEvent.input(field, { target: { value: `x${i}` } })
      await advance(60_000)
    }
    expect(onTimeout).not.toHaveBeenCalled()
    expect(get.mock.calls.every(([u]) => u === '/auth/session?context=onboarding')).toBe(true)
    field.remove()
  })

  it('a truly idle onboarding screen still ends, after the longer window', async () => {
    get.mockResolvedValue(answer(60))
    const onTimeout = vi.fn()
    render(<IdleTimeoutManager timeoutMinutes={15} onTimeout={onTimeout} context="onboarding" />)
    await act(async () => Promise.resolve())
    await advance(30 * 60_000)
    expect(onTimeout).not.toHaveBeenCalled()
    await advance(31 * 60_000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('leaving onboarding restores the normal 15-minute rule', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(answer(url.includes('context=onboarding') ? 60 : 15))
    )
    const onTimeout = vi.fn()
    const { rerender } = render(
      <IdleTimeoutManager timeoutMinutes={15} onTimeout={onTimeout} context="onboarding" />
    )
    await act(async () => Promise.resolve())
    rerender(<IdleTimeoutManager timeoutMinutes={15} onTimeout={onTimeout} context={null} />)
    await act(async () => Promise.resolve())
    expect(get).toHaveBeenLastCalledWith('/auth/session')
    await advance(15 * 60_000 + 1_000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })
})
