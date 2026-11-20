'use client'

/**
 * CTO-40: the clinic's connected stores. Re-sync (a new import with a
 * preview) or disconnect, which wipes MedoFlow's copy of the credentials.
 * Imported products stay on the Storefront.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppBadge, AppButton, AppModal, AppPageHeader } from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { useAppToast } from '@/hooks/useAppToast'
import { apiErrorOf } from '@/lib/apiError'
import {
  PROVIDER_LABELS,
  disconnectStore,
  getStoreConnections,
  startStoreImport,
  type StoreConnection,
} from '@/lib/catalogImportApi'

export default function IntegrationsPage() {
  const router = useRouter()
  const toast = useAppToast()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<StoreConnection | null>(null)
  const [ownerAction, setOwnerAction] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['store-connections'],
    queryFn: getStoreConnections,
  })
  const onError = (err: unknown) => toast.error(apiErrorOf(err).message)

  const resync = useMutation({
    mutationFn: (c: StoreConnection) => startStoreImport(c.id),
    onSuccess: (imp) => router.push(`/dashboard/products/import?id=${imp.id}`),
    onError,
  })
  const disconnect = useMutation({
    mutationFn: (c: StoreConnection) => disconnectStore(c.id),
    onSuccess: (res) => {
      setConfirm(null)
      setOwnerAction(res.ownerAction)
      toast.success(`${res.connection.displayName} disconnected`)
      void qc.invalidateQueries({ queryKey: ['store-connections'] })
    },
    onError,
  })

  const connections = data?.connections ?? []

  return (
    <PageContainer className="max-w-4xl space-y-6">
      <AppPageHeader
        title="Integrations"
        description="Stores your products are imported from. MedoFlow only reads products and stock."
        actions={
          <AppButton onClick={() => router.push('/dashboard/products/import')}>
            Connect a store
          </AppButton>
        }
      />
      {ownerAction && (
        <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          {ownerAction}
        </p>
      )}
      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : connections.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No stores connected yet. Connect Shopify, Square, WooCommerce or Wix to import your
          catalog, or upload a product file.
        </p>
      ) : (
        <ul className="space-y-3">
          {connections.map((c) => (
            <li
              key={c.id}
              data-testid="store-connection"
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-slate-900">
                  {c.displayName}
                  <AppBadge
                    variant={
                      c.status === 'ACTIVE'
                        ? 'success'
                        : c.status === 'ERROR'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {c.status === 'ACTIVE'
                      ? 'Connected'
                      : c.status === 'ERROR'
                        ? 'Needs attention'
                        : 'Disconnected'}
                  </AppBadge>
                </p>
                <p className="text-xs text-slate-500">
                  {`${PROVIDER_LABELS[c.provider]}${c.lastSyncedAt ? `, last read ${new Date(c.lastSyncedAt).toLocaleString()}` : ''}`}
                </p>
                {c.lastError && <p className="mt-1 text-xs text-rose-700">{c.lastError}</p>}
              </div>
              {c.status !== 'DISCONNECTED' ? (
                <div className="flex gap-2">
                  <AppButton size="sm" onClick={() => resync.mutate(c)} disabled={resync.isPending}>
                    Re-sync products
                  </AppButton>
                  <AppButton size="sm" variant="outline" onClick={() => setConfirm(c)}>
                    Disconnect
                  </AppButton>
                </div>
              ) : (
                <AppButton
                  size="sm"
                  variant="outline"
                  onClick={() => router.push('/dashboard/products/import')}
                >
                  Connect again
                </AppButton>
              )}
            </li>
          ))}
        </ul>
      )}
      <AppModal
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Disconnect ${confirm?.displayName ?? ''}?`}
        description="MedoFlow deletes its access to this store. Products already imported stay on your Storefront, and connecting again links them back up."
        primaryAction={{
          label: disconnect.isPending ? 'Disconnecting…' : 'Disconnect',
          onClick: () => confirm && disconnect.mutate(confirm),
          disabled: disconnect.isPending,
        }}
        secondaryAction={{ label: 'Cancel', onClick: () => setConfirm(null) }}
      />
    </PageContainer>
  )
}
