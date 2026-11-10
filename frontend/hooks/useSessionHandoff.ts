'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import {
  configuredAppOrigin,
  handoffBounceUrl,
  readHandoffParam,
  withoutHandoffParam,
} from '@/lib/authHandoff'

/**
 * Carries a patient's app sign-in onto a clinic's own domain (lib/authHandoff).
 * Returns `pending` while the bounce or the code exchange is in flight, so the
 * page can show a loader instead of a sign-in prompt that is about to vanish.
 */
export function useSessionHandoff(): { pending: boolean } {
  const router = useRouter()
  const { isLoading, isAuthenticated, exchangeHandoffCode } = useAuth()
  const [pending, setPending] = useState(true)
  const started = useRef(false)

  useEffect(() => {
    if (isLoading || started.current) return
    started.current = true
    const href = window.location.href
    const param = readHandoffParam(href)

    if (param !== null) {
      // Back from the app host: drop the param either way so a reload
      // never replays a spent code.
      void (async () => {
        if (param !== 'none' && !isAuthenticated) await exchangeHandoffCode(param)
        router.replace(withoutHandoffParam(href))
        setPending(false)
      })()
      return
    }

    if (!isAuthenticated) {
      const bounce = handoffBounceUrl(href, configuredAppOrigin())
      if (bounce) {
        window.location.replace(bounce)
        return
      }
    }
    setPending(false)
  }, [isLoading, isAuthenticated, exchangeHandoffCode, router])

  return { pending: isLoading || pending }
}
