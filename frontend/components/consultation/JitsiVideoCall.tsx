'use client'

import React, { useEffect, useRef, useState } from 'react'
import { clientLog } from '@/lib/clientLog'

interface JitsiVideoCallProps {
  /** Room path — "<appId>/<name>" for JaaS, or "<name>" for meet.jit.si */
  roomName: string
  userName?: string
  /** Jitsi host, e.g. "8x8.vc" (JaaS) or "meet.jit.si" (public). Defaults to 8x8.vc. */
  domain?: string
  /** JWT minted by our backend for JaaS — required for 8x8.vc, ignored for meet.jit.si. */
  jwt?: string
  /** Fires when the local participant actually enters the conference (Jitsi `videoConferenceJoined`). */
  onMeetingStarted?: () => void
  /** Fires when the local participant leaves or clicks Leave (Jitsi `readyToClose`). */
  onCallEnded?: () => void
  className?: string
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

// We load one external_api.js per domain. In practice the whole app will
// use a single domain (8x8.vc for JaaS, or meet.jit.si for the fallback),
// but keyed state means if someone ever mixes the two it still works.
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
  className = '',
}: JitsiVideoCallProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<any>(null)
  const onCallEndedRef = useRef(onCallEnded)
  const onMeetingStartedRef = useRef(onMeetingStarted)
  const [scriptError, setScriptError] = useState(false)

  useEffect(() => {
    onCallEndedRef.current = onCallEnded
  }, [onCallEnded])
  useEffect(() => {
    onMeetingStartedRef.current = onMeetingStarted
  }, [onMeetingStarted])

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
            // Don't surface meet.jit.si's moderator-lobby waiting
            // state — we generate a fresh room per call on the
            // backend so the first joiner is auto-moderator.
            enableLobbyChat: false,
            lobby: { enabled: false, autoKnock: false },
            toolbarButtons: [
              'microphone',
              'camera',
              'hangup',
              'chat',
              'tileview',
              'fullscreen',
              'settings',
            ],
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
          onCallEndedRef.current?.()
        })

        // Only log non-fatal errors to console — don't surface them to UI.
        // Jitsi shows its own error messages inside the iframe for all
        // recoverable issues (permissions, ICE, etc.).
        api.addEventListener('errorOccurred', (evt: any) => {
          const isFatal = evt?.error?.isFatal ?? false
          const name = evt?.error?.name ?? 'unknown'
          const msg = evt?.error?.message ?? ''
          if (isFatal) {
            clientLog.error('[Jitsi] fatal error', { name, message: msg })
          } else {
            clientLog.warn('[Jitsi] non-fatal error (handled internally)', { name, message: msg })
          }
          // We intentionally do NOT show a UI overlay here.
          // Jitsi handles all errors (fatal or not) with its own in-frame UI.
        })
      } catch (err: any) {
        clientLog.error('[Jitsi] Failed to instantiate API:', err)
      }
    }

    if (typeof window !== 'undefined') {
      if (window.JitsiMeetExternalAPI) {
        createApi()
      } else {
        unregisterScript = loadJitsiScript(domain, createApi, () => {
          if (!cancelled) setScriptError(true)
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
  }, [roomName, userName, domain, jwt])

  if (scriptError) {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl bg-slate-900 ${className}`}
        style={{ minHeight: '520px' }}
      >
        <div className="text-center p-6">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-white/80 text-sm mb-2">
            Could not load video call.
            <br />
            <span className="text-white/50 text-xs">
              Check your internet connection and try refreshing.
            </span>
          </p>
          <button
            onClick={() => {
              setScriptError(false)
              scriptStateByDomain[domain] = 'idle'
            }}
            className="mt-3 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`relative w-full rounded-2xl overflow-hidden bg-slate-900 ${className}`}
      style={{ height: '640px' }}
    >
      {/* Jitsi renders its full UI here — lobby, conference, error messages all inside the iframe.
                NB: the container MUST have an explicit `height` (not min-height). Jitsi's external_api
                injects an iframe with `style="height: 100%"`, and CSS `height: 100%` only resolves
                against a parent with an explicit `height` — min-height alone leaves the iframe
                collapsed to the browser-default 150px. */}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}
