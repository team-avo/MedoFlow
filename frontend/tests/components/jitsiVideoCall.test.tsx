/**
 * Video consultations: the embedded 8x8 call shows only the agreed controls
 * (no recording, livestreaming or invites), and a call that cannot start —
 * blocked script, or 8x8 refusing the token — shows a panel whose
 * "Try again" asks the page for a fresh token.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { JitsiVideoCall, JITSI_TOOLBAR_BUTTONS } from '@/components/consultation/JitsiVideoCall'

type Listener = (data?: unknown) => void
let lastOptions: Record<string, any> | null = null
let listeners: Record<string, Listener> = {}

class FakeJitsiApi {
  constructor(_domain: string, options: Record<string, any>) {
    lastOptions = options
  }
  addEventListener(event: string, handler: Listener) {
    listeners[event] = handler
  }
  dispose() {}
  executeCommand(cmd: string) {
    commands.push(cmd)
  }
}
let commands: string[] = []

beforeEach(() => {
  lastOptions = null
  listeners = {}
  commands = []
  window.JitsiMeetExternalAPI = FakeJitsiApi as never
})

afterEach(() => {
  delete (window as { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI
})

describe('JitsiVideoCall', () => {
  it('joins with the token and only the agreed controls', () => {
    render(<JitsiVideoCall roomName="app/room" jwt="signed.jwt" userName="Anika" />)
    expect(lastOptions?.roomName).toBe('app/room')
    expect(lastOptions?.jwt).toBe('signed.jwt')
    const config = lastOptions?.configOverwrite
    expect(config.toolbarButtons).toEqual([...JITSI_TOOLBAR_BUTTONS])
    for (const hidden of ['recording', 'livestreaming', 'invite', 'sharedvideo', 'desktop']) {
      expect(config.toolbarButtons).not.toContain(hidden)
    }
    expect(config.fileRecordingsEnabled).toBe(false)
    expect(config.liveStreamingEnabled).toBe(false)
    expect(config.prejoinPageEnabled).toBe(false)
  })

  it('reports joining and leaving', () => {
    const started = vi.fn()
    const ended = vi.fn()
    render(<JitsiVideoCall roomName="app/room" onMeetingStarted={started} onCallEnded={ended} />)
    act(() => listeners.videoConferenceJoined?.())
    act(() => listeners.readyToClose?.())
    expect(started).toHaveBeenCalledOnce()
    expect(ended).toHaveBeenCalledOnce()
  })

  it('a fatal error (e.g. a refused token) shows the panel; Try again asks for a new token', () => {
    const retry = vi.fn()
    render(<JitsiVideoCall roomName="app/room" jwt="old.jwt" onRetry={retry} />)
    act(() =>
      listeners.errorOccurred?.({ error: { isFatal: true, name: 'connection.passwordRequired' } })
    )
    expect(screen.getByRole('alert')).toHaveTextContent('The video call could not start.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('non-fatal errors stay inside the call', () => {
    render(<JitsiVideoCall roomName="app/room" />)
    act(() => listeners.errorOccurred?.({ error: { isFatal: false, name: 'ice' } }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('without onRetry, Try again remounts the call itself', () => {
    render(<JitsiVideoCall roomName="app/room" />)
    act(() => listeners.errorOccurred?.({ error: { isFatal: true, name: 'x' } }))
    lastOptions = null
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect((lastOptions as Record<string, any> | null)?.roomName).toBe('app/room')
  })

  it('a script that cannot load shows its own message', () => {
    delete (window as { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI
    render(<JitsiVideoCall roomName="app/room" domain="blocked.example" />)
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[src="https://blocked.example/external_api.js"]'
    )
    expect(script).not.toBeNull()
    act(() => {
      script!.onerror?.(new Event('error'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the video call.')
  })

  it('uses the height it is given', () => {
    const { container } = render(<JitsiVideoCall roomName="app/room" height="500px" />)
    expect((container.firstChild as HTMLElement).style.height).toBe('500px')
  })
})

describe('idle call (CTO-35)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const tick = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
  }
  const setup = () => {
    const ended = vi.fn()
    const autoEnd = vi.fn()
    render(
      <JitsiVideoCall
        roomName="app/room"
        onCallEnded={ended}
        onAutoEnd={autoEnd}
        aloneMs={60_000}
        promptMs={30_000}
      />
    )
    act(() => listeners.videoConferenceJoined?.())
    return { ended, autoEnd }
  }

  it('alone and silent: asks after 60 s, then ends the call after 30 s more', async () => {
    const { ended, autoEnd } = setup()
    // Waiting for the patient is not "left alone": nothing happens.
    await tick(5 * 60_000)
    expect(screen.queryByTestId('idle-call-prompt')).toBeNull()

    act(() => listeners.participantJoined?.({ id: 'patient' }))
    await tick(10_000)
    act(() => listeners.participantLeft?.({ id: 'patient' }))
    await tick(59_000)
    expect(screen.queryByTestId('idle-call-prompt')).toBeNull()
    await tick(2_000)
    expect(screen.getByTestId('idle-call-prompt')).toHaveTextContent('Are you still there?')
    await tick(30_000)
    expect(commands).toContain('hangup')
    expect(autoEnd).toHaveBeenCalledOnce()
    // The page's normal end-of-call path runs once (stops the recording, keeps it).
    expect(ended).toHaveBeenCalledOnce()
    act(() => listeners.readyToClose?.())
    expect(ended).toHaveBeenCalledOnce()
  })

  it('"I\'m still here", a key press or speaking resets the countdown', async () => {
    const { autoEnd } = setup()
    act(() => listeners.participantJoined?.({ id: 'patient' }))
    act(() => listeners.participantLeft?.({ id: 'patient' }))
    await tick(61_000)
    fireEvent.click(screen.getByRole('button', { name: "I'm still here" }))
    await tick(1_000)
    expect(screen.queryByTestId('idle-call-prompt')).toBeNull()
    await tick(50_000)
    act(() => listeners.audioLevelsChanged?.({ id: 'me', audioLevel: 0.4 }))
    await tick(50_000)
    fireEvent.keyDown(window, { key: 'a' })
    await tick(50_000)
    expect(autoEnd).not.toHaveBeenCalled()
    // Someone rejoins: never alone, never ended.
    act(() => listeners.participantJoined?.({ id: 'patient' }))
    await tick(5 * 60_000)
    expect(autoEnd).not.toHaveBeenCalled()
  })
})
