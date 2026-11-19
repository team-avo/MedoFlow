'use client'

/**
 * CTO-40: where the products come from. A store already connected, a store
 * to connect (Shopify, Square, WooCommerce, Wix), or a file: any store's
 * product export, a marketplace seller sheet (for example Tata 1mg), a
 * med-spa software export or a price list, as CSV or Excel.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Store, Upload } from 'lucide-react'
import {
  AppButton,
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppFormField,
  AppInput,
  AppSelect,
} from '@/components/ui-system'
import type { AppInputProps } from '@/components/ui-system/AppInput'

/** An input with its visible label. */
function Field({ label, id, ...props }: AppInputProps & { label: string; id: string }) {
  return (
    <AppFormField label={label} htmlFor={id}>
      <AppInput id={id} {...props} />
    </AppFormField>
  )
}
import { useAppToast } from '@/hooks/useAppToast'
import { apiErrorOf } from '@/lib/apiError'
import {
  PROVIDER_LABELS,
  connectWixKey,
  connectWooCommerceKey,
  getStoreConnections,
  listImports,
  startStoreConnection,
  startStoreImport,
  uploadImportFile,
  type CatalogImport,
  type ProviderInfo,
  type StoreConnection,
  type StoreProvider,
} from '@/lib/catalogImportApi'

const PROVIDER_HELP: Record<StoreProvider, string> = {
  SHOPIFY: 'Sign in to Shopify and allow MedoFlow to read your products and stock.',
  SQUARE: 'For products you sell at the front desk through Square. Read-only access.',
  WOOCOMMERCE:
    'WooCommerce asks you to approve a read-only key. You can also paste a key you made under WooCommerce > Settings > Advanced > REST API.',
  WIX: 'In your Wix account, create an API key with permission to read Wix Stores products, then paste it here with your site id (from your Wix dashboard address).',
}

export function SourcePicker({
  onStarted,
}: {
  /** An import was created; `file` is kept so the owner can re-map its columns. */
  onStarted: (imp: CatalogImport, file?: File) => void
}) {
  const toast = useAppToast()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['store-connections'], queryFn: getStoreConnections })
  const { data: meta } = useQuery({ queryKey: ['catalog-imports'], queryFn: listImports })
  const onError = (err: unknown) => toast.error(apiErrorOf(err).message)

  const importFrom = useMutation({
    mutationFn: (c: StoreConnection) => startStoreImport(c.id),
    onSuccess: (imp) => onStarted(imp),
    onError,
  })

  const active = (data?.connections ?? []).filter((c) => c.status !== 'DISCONNECTED')

  return (
    <div className="space-y-8">
      {active.length > 0 && (
        <section aria-labelledby="connected-stores" className="space-y-3">
          <h2 id="connected-stores" className="text-base font-semibold text-slate-900">
            Your connected stores
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{c.displayName}</p>
                  <p className="text-xs text-slate-500">
                    {PROVIDER_LABELS[c.provider]}
                    {c.lastSyncedAt
                      ? `, last read ${new Date(c.lastSyncedAt).toLocaleString()}`
                      : ', not read yet'}
                  </p>
                  {c.status === 'ERROR' && c.lastError && (
                    <p className="mt-1 text-xs text-rose-700">{c.lastError}</p>
                  )}
                </div>
                <AppButton
                  size="sm"
                  onClick={() => importFrom.mutate(c)}
                  disabled={importFrom.isPending}
                >
                  Import products
                </AppButton>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="connect-store" className="space-y-3">
        <h2 id="connect-store" className="text-base font-semibold text-slate-900">
          Connect a store
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(data?.providers ?? []).map((p) => (
            <ConnectCard
              key={p.provider}
              info={p}
              onConnected={() => {
                toast.success(`${p.label} connected`)
                void qc.invalidateQueries({ queryKey: ['store-connections'] })
              }}
              onError={onError}
            />
          ))}
        </div>
      </section>

      <FileUpload
        presets={meta?.presets ?? []}
        onStarted={(imp, file) => onStarted(imp, file)}
        onError={onError}
      />
    </div>
  )
}

function ConnectCard({
  info,
  onConnected,
  onError,
}: {
  info: ProviderInfo
  onConnected: () => void
  onError: (err: unknown) => void
}) {
  const [shop, setShop] = useState('')
  const [storeUrl, setStoreUrl] = useState('')
  const [showKey, setShowKey] = useState(info.connectKind === 'key')
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [siteId, setSiteId] = useState('')
  const id = info.provider.toLowerCase()

  const redirect = useMutation({
    mutationFn: () => startStoreConnection(info.provider, { shop, storeUrl }),
    onSuccess: (url) => {
      window.location.assign(url)
    },
    onError,
  })
  const keyConnect = useMutation({
    mutationFn: () =>
      info.provider === 'WIX'
        ? connectWixKey({ siteId, apiKey: secret })
        : connectWooCommerceKey({ storeUrl, consumerKey: key, consumerSecret: secret }),
    onSuccess: () => {
      setKey('')
      setSecret('')
      onConnected()
    },
    onError,
  })
  const busy = redirect.isPending || keyConnect.isPending

  return (
    <AppCard className="border-slate-200" data-testid={`connect-${id}`}>
      <AppCardHeader className="pb-2">
        <AppCardTitle className="flex items-center gap-2 text-base">
          <Store className="h-4 w-4 text-primary-600" aria-hidden /> {info.label}
        </AppCardTitle>
      </AppCardHeader>
      <AppCardContent className="space-y-3">
        <p className="text-sm text-slate-600">{PROVIDER_HELP[info.provider]}</p>
        {!info.configured ? (
          <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            {`${info.label} is not set up on this server yet. Ask the MedoFlow team, or import a ${info.label} product export file below.`}
          </p>
        ) : (
          <>
            {info.provider === 'SHOPIFY' && (
              <Field
                id={`${id}-shop`}
                label="Shopify address"
                placeholder="your-store.myshopify.com"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
              />
            )}
            {info.provider === 'WOOCOMMERCE' && (
              <Field
                id={`${id}-url`}
                label="Store address"
                placeholder="https://shop.yourclinic.com"
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
              />
            )}
            {info.provider === 'WIX' && (
              <Field
                id={`${id}-site`}
                label="Site id"
                placeholder="0a1b2c3d-...-..."
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              />
            )}
            {info.connectKind !== 'key' && (
              <AppButton
                onClick={() => redirect.mutate()}
                disabled={
                  busy ||
                  (info.provider === 'SHOPIFY' && !shop.trim()) ||
                  (info.provider === 'WOOCOMMERCE' && !storeUrl.trim())
                }
              >
                {`Connect ${info.label}`}
              </AppButton>
            )}
            {info.connectKind === 'oauth_or_key' && !showKey && (
              <button
                type="button"
                className="block text-xs font-medium text-primary-700 underline"
                onClick={() => setShowKey(true)}
              >
                Paste a key instead
              </button>
            )}
            {showKey && (
              <div className="space-y-2">
                {info.provider === 'WOOCOMMERCE' && (
                  <Field
                    id={`${id}-key`}
                    label="Consumer key"
                    placeholder="ck_..."
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                )}
                <Field
                  id={`${id}-secret`}
                  label={info.provider === 'WIX' ? 'API key' : 'Consumer secret'}
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
                <AppButton
                  variant="outline"
                  onClick={() => keyConnect.mutate()}
                  disabled={
                    busy ||
                    !secret.trim() ||
                    (info.provider === 'WIX' ? !siteId.trim() : !key.trim() || !storeUrl.trim())
                  }
                >
                  {info.provider === 'WIX' ? 'Connect Wix' : 'Connect with this key'}
                </AppButton>
              </div>
            )}
          </>
        )}
      </AppCardContent>
    </AppCard>
  )
}

function FileUpload({
  presets,
  onStarted,
  onError,
}: {
  presets: { id: string; label: string }[]
  onStarted: (imp: CatalogImport, file: File) => void
  onError: (err: unknown) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preset, setPreset] = useState('auto')
  const upload = useMutation({
    mutationFn: (f: File) => uploadImportFile(f, { preset }),
    onSuccess: (imp) => onStarted(imp, file!),
    onError,
  })
  return (
    <section
      aria-labelledby="upload-file"
      className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-5"
    >
      <h2
        id="upload-file"
        className="flex items-center gap-2 text-base font-semibold text-slate-900"
      >
        <Upload className="h-4 w-4" aria-hidden /> Upload a file
      </h2>
      <p className="text-sm text-slate-600">
        A product export from Shopify, Wix, Square or WooCommerce, a marketplace seller sheet (for
        example Tata 1mg), an export from your clinic or med-spa software, or your own spreadsheet.
        CSV or Excel (.xlsx), up to 5 MB and 5,000 products. Nothing is saved until you review it.
      </p>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div>
          <label htmlFor="import-file" className="mb-1 block text-sm font-medium text-slate-700">
            File
          </label>
          <input
            id="import-file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <AppSelect
          id="import-preset"
          label="File type"
          value={preset}
          onValueChange={setPreset}
          options={[
            { value: 'auto', label: 'Detect automatically' },
            ...presets.map((p) => ({ value: p.id, label: p.label })),
          ]}
        />
        <AppButton onClick={() => file && upload.mutate(file)} disabled={!file || upload.isPending}>
          {upload.isPending ? 'Reading…' : 'Read file'}
        </AppButton>
      </div>
    </section>
  )
}
