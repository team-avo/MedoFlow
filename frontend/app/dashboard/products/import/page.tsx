'use client'

/**
 * CTO-40: import the products a clinic already sells elsewhere. Pick a
 * source, review the dry run, classify, import. The import id lives in the
 * address (?id=), so a refresh or an OAuth round trip comes back here.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { AppButton, AppPageHeader } from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { SourcePicker } from '@/components/catalogImport/SourcePicker'
import { ImportPreview } from '@/components/catalogImport/ImportPreview'
import { useAppToast } from '@/hooks/useAppToast'
import { apiErrorOf } from '@/lib/apiError'
import {
  PROVIDER_LABELS,
  getImport,
  isImportBusy,
  retryImport,
  type CatalogImport,
  type StoreProvider,
} from '@/lib/catalogImportApi'

const PATH = '/dashboard/products/import'

export default function ImportProductsPage() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id')
  const qc = useQueryClient()
  const toast = useAppToast()
  const [file, setFile] = useState<File | null>(null)

  const show = (imp: CatalogImport, f?: File) => {
    if (f) setFile(f)
    qc.setQueryData(['catalog-import', imp.id], imp)
    router.replace(`${PATH}?id=${imp.id}`)
  }

  const { data: imp, isLoading } = useQuery({
    queryKey: ['catalog-import', id],
    queryFn: () => getImport(id!),
    enabled: !!id,
    refetchInterval: (q) => (isImportBusy(q.state.data?.status) ? 2_000 : false),
  })

  const retry = useMutation({
    mutationFn: () => retryImport(id!),
    onSuccess: (next) => qc.setQueryData(['catalog-import', id], next),
    onError: (err) => toast.error(apiErrorOf(err).message),
  })

  const sourceName =
    imp && imp.source !== 'CSV' ? PROVIDER_LABELS[imp.source as StoreProvider] : 'your file'

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Import products"
        description="Bring in the products you already sell on Shopify, Square, WooCommerce, Wix, a marketplace or a spreadsheet. Review everything before it reaches your Storefront."
        actions={
          id ? (
            <AppButton variant="outline" onClick={() => router.replace(PATH)}>
              Start another import
            </AppButton>
          ) : (
            <Link href="/dashboard/products" className="text-sm font-medium text-primary-700">
              Back to Storefront
            </Link>
          )
        }
      />

      {!id && params.get('connected') && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
          Store connected. Choose it under Your connected stores to import its products.
        </p>
      )}

      {!id && <SourcePicker onStarted={show} />}

      {id && isLoading && <Busy text="Loading the import…" />}

      {imp?.status === 'FETCHING' && (
        <Busy text={`Reading the products from ${sourceName}. Large catalogs take a minute.`} />
      )}

      {imp?.status === 'APPLYING' && <Busy text="Importing products and photos…" />}

      {imp?.status === 'PREVIEW_READY' && (
        <ImportPreview imp={imp} file={file} onReplaced={(next) => show(next)} />
      )}

      {imp?.status === 'FAILED' && (
        <div
          role="alert"
          className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900"
        >
          <p className="font-medium">{`The import did not finish: ${imp.lastError ?? 'unknown error'}`}</p>
          {imp.storeConnectionId || imp.summary.failedPhase === 'apply' ? (
            <AppButton onClick={() => retry.mutate()} disabled={retry.isPending}>
              Retry
            </AppButton>
          ) : (
            <AppButton onClick={() => router.replace(PATH)}>Upload the file again</AppButton>
          )}
        </div>
      )}

      {imp?.status === 'DONE' && <Done imp={imp} />}
    </PageContainer>
  )
}

function Busy({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700"
    >
      <Loader2 className="h-5 w-5 animate-spin text-primary-600" aria-hidden />
      {text}
    </div>
  )
}

function Done({ imp }: { imp: CatalogImport }) {
  const r = imp.summary.result
  return (
    <div
      role="status"
      data-testid="import-done"
      className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-950"
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        <CheckCircle2 className="h-5 w-5" aria-hidden /> Import finished
      </p>
      <ul className="list-inside list-disc space-y-1">
        <li>{`${r?.created ?? 0} products added`}</li>
        <li>{`${r?.updated ?? 0} products updated`}</li>
        {(r?.imagesImported ?? 0) > 0 && <li>{`${r?.imagesImported} photos added`}</li>}
        {(r?.imagesSkipped ?? 0) > 0 && <li>{`${r?.imagesSkipped} photos could not be copied`}</li>}
        {(r?.failed ?? 0) > 0 && <li>{`${r?.failed} products could not be imported`}</li>}
      </ul>
      {(r?.unclassified ?? 0) > 0 && (
        <p className="rounded-lg bg-amber-100 p-3 text-amber-950">
          {`${r?.unclassified} ${r?.unclassified === 1 ? 'product needs' : 'products need'} a class before ${r?.unclassified === 1 ? 'it' : 'they'} can be sold. Choose one on the product's card on the Storefront.`}
        </p>
      )}
      <Link href="/dashboard/products">
        <AppButton>Go to the Storefront</AppButton>
      </Link>
    </div>
  )
}
