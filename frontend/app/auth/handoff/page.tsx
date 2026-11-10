'use client'

/**
 * App-host half of the session handoff (lib/authHandoff). A clinic booking
 * page on the clinic's own domain sends a signed-out visitor here; once the
 * app session is restored, the API says where to go back to: the clinic page
 * with a one-time code (signed-in patient) or with `handoff=none` (anyone
 * else). The API validates the return URL, so this page never redirects to a
 * site that isn't a live clinic website.
 */
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { HANDOFF_RETURN_PARAM } from '@/lib/authHandoff'
import { MedoflowFullScreen } from '@/components/common/MedoflowLoader'

function HandoffInner() {
  const search = useSearchParams()
  const { isLoading } = useAuth()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (isLoading || started.current) return
    started.current = true
    const returnUrl = search.get(HANDOFF_RETURN_PARAM)
    if (!returnUrl) {
      setFailed(true)
      return
    }
    api
      .post<{ data: { redirectUrl: string } }>('/auth/handoff/start', { returnUrl })
      .then(({ data }) => window.location.replace(data.data.redirectUrl))
      .catch(() => setFailed(true))
  }, [isLoading, search])

  if (failed) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-xl font-semibold text-slate-900">This link can&apos;t be used</h1>
        <p className="mt-2 text-sm text-slate-500">
          Go back to the clinic&apos;s website and try booking again.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-teal-700">
          Go to MedoFlow
        </Link>
      </main>
    )
  }
  return <MedoflowFullScreen subtitle="Signing you in" />
}

export default function HandoffPage() {
  return (
    <React.Suspense fallback={<MedoflowFullScreen subtitle="Signing you in" />}>
      <HandoffInner />
    </React.Suspense>
  )
}
