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
  executeCommand() {}
}

beforeEach(() => {
  lastOptions = null
  listeners = {}
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
