'use client'

/**
 * The patient's checkout link for a clinic without a website (CTO-32):
 * /c/<clinic-slug>/cart?t=<token>. The patient signs in (as the cart's own
 * patient), the link is checked, and they land on the MedoFlow-hosted,
 * clinic-branded checkout with the existing cart and one-click pay.
 */
import * as React from 'react'
import { Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { apiErrorOf } from '@/lib/apiError'
import { LoadingSkeleton } from '@/components/ui-system'

function CheckoutLink() {
  const router = useRouter()
  const params = useParams()
  const search = useSearchParams()
  const { user, isLoading } = useAuth()
  const token = search.get('t') ?? ''
  const slug = String(params.slug ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const ran = React.useRef(false)

  React.useEffect(() => {
    if (isLoading || ran.current) return
    const here = `/c/${encodeURIComponent(slug)}/cart?t=${encodeURIComponent(token)}`
    if (!user) {
      ran.current = true
      router.replace(`/?auth=login&returnUrl=${encodeURIComponent(here)}`)
      return
    }
    if (user.role !== 'PATIENT') {
      ran.current = true
      setError('This link is for the patient. Sign in with the patient account to check out.')
      return
    }
    ran.current = true
    api
      .post<{ data: { clinicId: string; clinicSlug: string | null } }>('/checkout-links/open', {
        token,
      })
      .then(({ data }) =>
        router.replace(
          `/checkout?clinic=${encodeURIComponent(data.data.clinicSlug ?? data.data.clinicId)}`
        )
      )
      .catch((err) =>
        setError(
          apiErrorOf(err).status === 404
            ? 'This checkout link has expired or belongs to another account. Ask the clinic for a new one.'
            : apiErrorOf(err).message
        )
      )
  }, [isLoading, user, token, slug, router])

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center" role="alert">
        <h1 className="text-lg font-semibold text-slate-900">Checkout link</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <LoadingSkeleton variant="card" />
    </div>
  )
}

export default function CheckoutLinkPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutLink />
    </Suspense>
  )
}
