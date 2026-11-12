'use client'

import React, { useEffect, useRef, useState } from 'react'
import { clientLog } from '@/lib/clientLog'
import {
  DEFAULT_ALONE_MS,
  DEFAULT_PROMPT_MS,
  idleCallPhase,
  promptSecondsLeft,
  SPEAKING_LEVEL,
  type IdleCallState,
} from '@/lib/idleCall'

/**
 * The only controls shown in the call. Recording, livestreaming, screen
 * sharing to third parties and invites are left out on purpose: nothing about
 * a consultation is stored or relayed by 8x8 (the backend's token turns those
 * features off as well).
 */
export const JITSI_TOOLBAR_BUTTONS = [
  'microphone',
  'camera',
  'hangup',
  'chat',
  'tileview',
  'fullscreen',
  'settings',
] as const

interface JitsiVideoCallProps {
  /** Room path, "<appId>/<name>" (8x8 JaaS). */
  roomName: string
  userName?: string
  /** Jitsi host. Defaults to 8x8.vc (JaaS). */
  domain?: string
  /** JWT minted by our backend for this user and room. */
  jwt?: string
  /** Fires when the local participant actually enters the conference (Jitsi `videoConferenceJoined`). */
  onMeetingStarted?: () => void
  /** Fires when the local participant leaves or clicks Leave (Jitsi `readyToClose`). */
  onCallEnded?: () => void
  /**
   * Called by "Try again" after the call could not start (script blocked, or
   * 8x8 refused the token). The parent should fetch a fresh token; without
   * it the component just reloads the call.
   */
  onRetry?: () => void
  /** CSS height of the call area. Jitsi needs an explicit height. */
  height?: string
  className?: string
  /**
   * CTO-35: end the call for this participant once everyone else has left
   * and nobody answers "Are you still there?". Called after the hang-up.
   */
  onAutoEnd?: () => void
  /** Overrides for the idle thresholds (milliseconds). */
  aloneMs?: number
  promptMs?: number
}

declare global {
  interface Window {
    JitsiMeetExternalAPI: new (
      domain: string,
      options: object
    ) => {
      dispose: () => void
      addEventListener: (event: string, handler: (data?: any) => void) => void
      executeCommand: (command: string, ...args: any[]) => void
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level script loader — loads external_api.js exactly once across
// React StrictMode double-invocations and multiple component mounts.
// ---------------------------------------------------------------------------
type ReadyCallback = () => void

// We load one external_api.js per domain. In practice the whole app uses a
// single domain (8x8.vc for JaaS); keyed state keeps a second one working.
type ScriptState = 'idle' | 'loading' | 'ready' | 'error'
const scriptStateByDomain: Record<string, ScriptState> = {}
const pendingByDomain: Record<string, ReadyCallback[]> = {}

function loadJitsiScript(domain: string, onReady: ReadyCallback, onError: () => void): () => void {
  const state = scriptStateByDomain[domain] ?? 'idle'
  const pending = pendingByDomain[domain] ?? []
  pendingByDomain[domain] = pending

  if (state === 'ready') {
    const t = setTimeout(onReady, 0)
    return () => clearTimeout(t)
  }
  if (state === 'error') {
    const t = setTimeout(onError, 0)
    return () => clearTimeout(t)
  }

  pending.push(onReady)
  const removeCallback = () => {
    const i = pending.indexOf(onReady)
    if (i !== -1) pending.splice(i, 1)
  }

  if (state === 'idle') {
    scriptStateByDomain[domain] = 'loading'
    const script = document.createElement('script')
    script.src = `https://${domain}/external_api.js`
    script.async = true
    script.onload = () => {
      scriptStateByDomain[domain] = 'ready'
      const cbs = pending.splice(0)
      cbs.forEach((cb) => cb())
    }
    script.onerror = () => {
      scriptStateByDomain[domain] = 'error'
      pending.splice(0)
      onError()
    }
    document.head.appendChild(script)
  }

  return removeCallback
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JitsiVideoCall({
  roomName,
  userName,
  domain = '8x8.vc',
  jwt,
  onMeetingStarted,
  onCallEnded,
  onRetry,
  height = 'clamp(360px, 70vh, 720px)',
  className = '',
  onAutoEnd,
  aloneMs = DEFAULT_ALONE_MS,
  promptMs = DEFAULT_PROMPT_MS,
}: JitsiVideoCallProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<any>(null)
  const onCallEndedRef = useRef(onCallEnded)
  const onMeetingStartedRef = useRef(onMeetingStarted)
  const [failure, setFailure] = useState<'script' | 'call' | null>(null)
  // Bumped by "Try again" so the effect below mounts the call afresh.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    onCallEndedRef.current = onCallEnded
  }, [onCallEnded])
  useEffect(() => {
    onMeetingStartedRef.current = onMeetingStarted
  }, [onMeetingStarted])

  // ── CTO-35: auto-end an idle call ──────────────────────────────────────
  const onAutoEndRef = useRef(onAutoEnd)
  useEffect(() => {
    onAutoEndRef.current = onAutoEnd
  }, [onAutoEnd])
  const othersRef = useRef(0)
  const idleRef = useRef<IdleCallState>({ aloneSince: null, lastActivity: Date.now() })
  const endedRef = useRef(false)
  // The call ends once: by Leave (readyToClose) or by the idle auto-end.
  const closedRef = useRef(false)
  const endCallOnce = React.useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    onCallEndedRef.current?.()
  }, [])
  const [prompt, setPrompt] = useState<number | null>(null) // seconds left, when shown
  const noteActivity = React.useCallback(() => {
    idleRef.current = { ...idleRef.current, lastActivity: Date.now() }
    setPrompt(null)
  }, [])
  const participantJoined = React.useCallback(() => {
    othersRef.current += 1
    idleRef.current = { aloneSince: null, lastActivity: Date.now() }
    setPrompt(null)
  }, [])
  const participantLeft = React.useCallback(() => {
    othersRef.current = Math.max(0, othersRef.current - 1)
    if (othersRef.current === 0) idleRef.current = { ...idleRef.current, aloneSince: Date.now() }
  }, [])
  // Depends on whether auto-end is on, not on the callback's identity: the
  // page re-renders every second while recording.
  const autoEndOn = !!onAutoEnd
  useEffect(() => {
    if (!autoEndOn) return
    const tick = window.setInterval(() => {
      if (endedRef.current) return
      const now = Date.now()
      const phase = idleCallPhase(now, idleRef.current, aloneMs, promptMs)
      if (phase === 'end') {
        endedRef.current = true
        setPrompt(null)
        try {
          apiRef.current?.executeCommand('hangup')
        } catch {}
        onAutoEndRef.current?.()
        // Stops any scribe recording cleanly, keeping what was captured.
        endCallOnce()
      } else if (phase === 'prompt') {
        setPrompt(promptSecondsLeft(now, idleRef.current, aloneMs, promptMs))
      } else {
        setPrompt((p) => (p === null ? p : null))
      }
    }, 1000)
    const events = ['pointerdown', 'keydown'] as const
    for (const e of events) window.addEventListener(e, noteActivity)
    return () => {
      window.clearInterval(tick)
      for (const e of events) window.removeEventListener(e, noteActivity)
    }
  }, [autoEndOn, aloneMs, promptMs, noteActivity, endCallOnce])

  useEffect(() => {
    if (!roomName) return

    let cancelled = false
    let unregisterScript: (() => void) | null = null

    const createApi = () => {
      if (cancelled || !containerRef.current) return

      try {
        const api = new window.JitsiMeetExternalAPI(domain, {
          roomName,
          parentNode: containerRef.current,
          userInfo: { displayName: userName || 'Participant' },
          ...(jwt ? { jwt } : {}),
          width: '100%',
          height: '100%',
          configOverwrite: {
            // Skip the "Join meeting" page — the user already clicked
            // "Start Video Call" / "Join video consultation" in our UI.
            // We want them to land straight in the conference.
            prejoinPageEnabled: false,
            prejoinConfig: { enabled: false },
            disableDeepLinking: true,
            enableWelcomePage: false,
            disableInviteFunctions: true,
            // No lobby: only the two people holding a token for this room
            // (signed by our backend) can enter it.
            enableLobbyChat: false,
            lobby: { enabled: false, autoKnock: false },
            toolbarButtons: [...JITSI_TOOLBAR_BUTTONS],
            fileRecordingsEnabled: false,
            liveStreamingEnabled: false,
            transcription: { enabled: false },
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_POWERED_BY: false,
            HIDE_INVITE_MORE_HEADER: true,
            MOBILE_APP_PROMO: false,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
          },
        })

        // Disposed before constructor returned (StrictMode teardown)
        if (cancelled) {
          try {
            api.dispose()
          } catch {}
          return
        }

        apiRef.current = api

        // Fires once, when the local user actually enters the conference
        // (past the prejoin / device-selection screen). This is the right
        // moment to auto-start AI Scribe recording.
        api.addEventListener('videoConferenceJoined', () => {
          onMeetingStartedRef.current?.()
        })

        api.addEventListener('readyToClose', () => {
          endCallOnce()
        })

        // CTO-35: who is in the room, and whether anyone is speaking.
        api.addEventListener('participantJoined', participantJoined)
        api.addEventListener('participantLeft', participantLeft)
        api.addEventListener('audioLevelsChanged', (evt: any) => {
          if (typeof evt?.audioLevel === 'number' && evt.audioLevel > SPEAKING_LEVEL) noteActivity()
        })

        // Jitsi shows recoverable issues (permissions, ICE, …) inside the
        // iframe. A fatal error — e.g. 8x8 refusing an expired or invalid
        // token — leaves a dead frame, so we replace it with our own panel.
        api.addEventListener('errorOccurred', (evt: any) => {
          const isFatal = evt?.error?.isFatal ?? false
          const name = evt?.error?.name ?? 'unknown'
          if (isFatal) {
            clientLog.error('[Jitsi] fatal error', { name })
            if (!cancelled) setFailure('call')
          } else {
            clientLog.warn('[Jitsi] non-fatal error (handled internally)', { name })
          }
        })
      } catch (err: any) {
        clientLog.error('[Jitsi] Failed to instantiate API:', err)
        if (!cancelled) setFailure('call')
      }
    }

    if (typeof window !== 'undefined') {
      if (window.JitsiMeetExternalAPI) {
        createApi()
      } else {
        unregisterScript = loadJitsiScript(domain, createApi, () => {
          if (!cancelled) setFailure('script')
        })
      }
    }

    return () => {
      cancelled = true
      unregisterScript?.()
      if (apiRef.current) {
        try {
          apiRef.current.dispose()
        } catch {}
        apiRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the idle callbacks are stable
  }, [roomName, userName, domain, jwt, attempt])

  if (failure) {
    return (
      <div
        role="alert"
        className={`flex items-center justify-center rounded-2xl bg-slate-900 ${className}`}
        style={{ height }}
      >
        <div className="text-center p-6">
          <p className="text-white/90 text-sm font-medium mb-1">
            {failure === 'script'
              ? 'Could not load the video call.'
              : 'The video call could not start.'}
          </p>
          <p className="text-white/60 text-xs">
            {failure === 'script'
              ? 'Check your internet connection, or whether a browser extension blocks 8x8.vc.'
              : 'Your access to the call may have expired.'}
          </p>
          <button
            type="button"
            onClick={() => {
              if (failure === 'script') {
                scriptStateByDomain[domain] = 'idle'
                document.querySelector(`script[src="https://${domain}/external_api.js"]`)?.remove()
              }
              setFailure(null)
              if (onRetry) onRetry()
              else setAttempt((n) => n + 1)
            }}
            className="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`relative w-full rounded-2xl overflow-hidden bg-slate-900 ${className}`}
      style={{ height }}
    >
      {/* Jitsi renders its full UI here — lobby, conference, error messages all inside the iframe.
                NB: the container MUST have an explicit `height` (not min-height). Jitsi's external_api
                injects an iframe with `style="height: 100%"`, and CSS `height: 100%` only resolves
                against a parent with an explicit `height` — min-height alone leaves the iframe
                collapsed to the browser-default 150px. */}
      <div ref={containerRef} className="w-full h-full" />
      {prompt !== null && (
        <div
          role="alertdialog"
          aria-labelledby="idle-call-title"
          data-testid="idle-call-prompt"
          className="absolute inset-x-4 bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-lg"
        >
          <div>
            <p id="idle-call-title" className="text-sm font-semibold text-slate-900">
              Are you still there?
            </p>
            <p className="text-xs text-slate-600">
              Everyone else has left. The call ends in{' '}
              <span className="font-semibold tabular-nums" aria-live="polite">
                {prompt}s
              </span>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={noteActivity}
            autoFocus
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            I&apos;m still here
          </button>
        </div>
      )}
    </div>
  )
}
