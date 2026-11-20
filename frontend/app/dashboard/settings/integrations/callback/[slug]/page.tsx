'use client'

/**
 * CTO-40: where a store's consent screen sends the browser back. Shopify and
 * Square return ?code=…&state=…, which the API exchanges and verifies;
 * WooCommerce has already posted its key to the API and returns ?success=1.
 * The query string is never logged or kept: it goes to the API once and the
 * address is replaced.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { AppButton } from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { apiErrorOf } from '@/lib/apiError'
import {
  PROVIDER_LABELS,
  completeStoreConnection,
  type StoreProvider,
} from '@/lib/catalogImportApi'

const PROVIDERS: Record<string, StoreProvider> = {
  shopify: 'SHOPIFY',
  square: 'SQUARE',
  woocommerce: 'WOOCOMMERCE',
}

export default function StoreConnectCallbackPage() {
  const { slug } = useParams<{ slug: string }>()
  const params = useSearchParams()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)
  const provider = PROVIDERS[slug]

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    if (!provider) {
      setError('Unknown store')
      return
    }
    const query = Object.fromEntries(params.entries())
    if (provider === 'WOOCOMMERCE') {
      if (query.success === '1') router.replace('/dashboard/products/import?connected=woocommerce')
      else setError('WooCommerce did not approve the connection')
      return
    }
    if (query.error) {
      setError(`${PROVIDER_LABELS[provider]} did not approve the connection`)
      return
    }
    completeStoreConnection(provider, query)
      .then(() => router.replace(`/dashboard/products/import?connected=${slug}`))
      .catch((err) => setError(apiErrorOf(err).message))
  }, [params, provider, router, slug])

  return (
    <PageContainer className="max-w-xl py-16">
      {error ? (
        <div
          role="alert"
          className="space-y-4 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900"
        >
          <p className="font-medium">{`The store was not connected: ${error}`}</p>
          <Link href="/dashboard/products/import">
            <AppButton>Try again</AppButton>
          </Link>
        </div>
      ) : (
        <p role="status" className="flex items-center gap-3 text-sm text-slate-700">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          {`Connecting ${provider ? PROVIDER_LABELS[provider] : 'the store'}…`}
        </p>
      )}
    </PageContainer>
  )
}
