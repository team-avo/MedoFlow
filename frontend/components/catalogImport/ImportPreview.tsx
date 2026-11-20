'use client'

/**
 * CTO-40: the dry run. What the import would create, update or leave alone,
 * with conflicts to resolve and a class to choose per product. Nothing
 * reaches the Storefront until "Import". Products left unclassified are
 * imported but not sold anywhere until someone classifies them.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { AppBadge, AppButton, AppInput, AppSelect } from '@/components/ui-system'
import { useAppToast } from '@/hooks/useAppToast'
import { apiErrorOf } from '@/lib/apiError'
import { FULFILLMENT_CLASS_LABELS, type FulfillmentClass } from '@/lib/rxCartApi'
import {
  applyImport,
  editImport,
  getImportRows,
  uploadImportFile,
  type CatalogImport,
  type ColumnMapping,
  type ImportEdits,
  type ImportRow,
  type MappedField,
  type RowAction,
  type RowFilter,
} from '@/lib/catalogImportApi'

const PAGE_SIZE = 50
const NONE = '__none__'

const ACTION_LABELS: Record<RowAction, string> = {
  CREATE: 'New',
  UPDATE: 'Update',
  UNCHANGED: 'No change',
  CONFLICT: 'Needs attention',
  ERROR: 'Cannot import',
}
const ACTION_VARIANT: Record<RowAction, 'success' | 'accent' | 'neutral' | 'warning' | 'danger'> = {
  CREATE: 'success',
  UPDATE: 'accent',
  UNCHANGED: 'neutral',
  CONFLICT: 'warning',
  ERROR: 'danger',
}

const FIELD_LABELS: Record<MappedField, string> = {
  name: 'Product name (required)',
  variant: 'Variant or pack size',
  sku: 'SKU or code',
  price: 'Price',
  description: 'Description',
  imageUrl: 'Image URL',
  stock: 'Stock on hand',
  category: 'Category or type',
  externalId: 'Item id',
}

const CLASS_OPTIONS = [
  { value: NONE, label: 'Leave unclassified' },
  ...(Object.keys(FULFILLMENT_CLASS_LABELS) as FulfillmentClass[]).map((c) => ({
    value: c,
    label: FULFILLMENT_CLASS_LABELS[c],
  })),
]

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : `$${n.toFixed(2)}`

export function ImportPreview({
  imp,
  file,
  onReplaced,
}: {
  imp: CatalogImport
  /** The uploaded file, kept in the page so the columns can be mapped again. */
  file: File | null
  onReplaced: (imp: CatalogImport) => void
}) {
  const toast = useAppToast()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<RowFilter>('all')
  const [page, setPage] = useState(1)
  const counts = imp.summary.counts
  const onError = (err: unknown) => toast.error(apiErrorOf(err).message)

  const rows = useQuery({
    queryKey: ['catalog-import', imp.id, 'rows', filter, page, imp.summary.counts],
    queryFn: () => getImportRows(imp.id, filter, page, PAGE_SIZE),
  })

  const edit = useMutation({
    mutationFn: (edits: ImportEdits) => editImport(imp.id, edits),
    onSuccess: (next) => {
      qc.setQueryData(['catalog-import', imp.id], next)
      void qc.invalidateQueries({ queryKey: ['catalog-import', imp.id, 'rows'] })
    },
    onError,
  })
  const apply = useMutation({
    mutationFn: () => applyImport(imp.id),
    onSuccess: (next) => qc.setQueryData(['catalog-import', imp.id], next),
    onError,
  })

  const toImport = (counts?.create ?? 0) + (counts?.update ?? 0)
  const tabs: { key: RowFilter; label: string; n?: number }[] = [
    { key: 'all', label: 'All', n: counts?.total },
    { key: 'create', label: 'New', n: counts?.create },
    { key: 'update', label: 'Updates', n: counts?.update },
    { key: 'conflict', label: 'Needs attention', n: counts?.conflict },
    { key: 'error', label: 'Cannot import', n: counts?.error },
    { key: 'unclassified', label: 'Unclassified', n: counts?.unclassified },
    { key: 'unchanged', label: 'No change', n: counts?.unchanged },
    { key: 'skipped', label: 'Skipped', n: counts?.skipped },
  ]

  return (
    <div className="space-y-6" data-testid="import-preview">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <AppBadge variant="success">{`${counts?.create ?? 0} new`}</AppBadge>
        <AppBadge variant="accent">{`${counts?.update ?? 0} to update`}</AppBadge>
        <AppBadge variant="neutral">{`${counts?.unchanged ?? 0} unchanged`}</AppBadge>
        {(counts?.conflict ?? 0) > 0 && (
          <AppBadge variant="warning">{`${counts?.conflict} need attention`}</AppBadge>
        )}
        {(counts?.error ?? 0) > 0 && (
          <AppBadge variant="danger">{`${counts?.error} cannot be imported`}</AppBadge>
        )}
      </div>

      {(imp.summary.warnings ?? []).map((w) => (
        <p key={w} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {w}
        </p>
      ))}
      {(counts?.rxLike ?? 0) > 0 && (
        <p className="flex gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {`${counts?.rxLike} products look like prescription items. They get no suggested class: choose one yourself. Prescription items go to e-prescribing, never the cart.`}
        </p>
      )}
      {(imp.summary.missingUpstream?.count ?? 0) > 0 && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          {`${imp.summary.missingUpstream!.count} products imported from this store before are no longer listed there (${imp.summary.missingUpstream!.names.slice(0, 5).join(', ')}). They are left as they are; remove them on the Storefront if you no longer sell them.`}
        </p>
      )}

      {imp.source === 'CSV' && imp.preset === 'generic' && (
        <ColumnMapper imp={imp} file={file} onReplaced={onReplaced} onError={onError} />
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-900">Classes</p>
          <p className="max-w-xl text-xs text-slate-600">
            {`${counts?.unclassified ?? 0} new products have no class yet. They will be imported but not sold (cart, website, Rx to cart) until you choose one, here or later on the Storefront.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <AppButton
              size="sm"
              variant="outline"
              disabled={edit.isPending}
              onClick={() => edit.mutate({ bulk: { acceptSuggestions: true } })}
            >
              Use the suggested classes
            </AppButton>
            <div className="w-56">
              <AppSelect
                id="bulk-class"
                placeholder="Set a class for all"
                options={CLASS_OPTIONS}
                disabled={edit.isPending}
                onValueChange={(v) =>
                  edit.mutate({
                    bulk: { chosenClass: v === NONE ? null : (v as FulfillmentClass) },
                  })
                }
              />
            </div>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={imp.options.syncPrice}
              disabled={edit.isPending}
              onChange={(e) => edit.mutate({ options: { syncPrice: e.target.checked } })}
            />
            Update prices of existing products
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={imp.options.syncStock}
              disabled={edit.isPending}
              onChange={(e) => edit.mutate({ options: { syncStock: e.target.checked } })}
            />
            Update stock of existing products
          </label>
        </div>
      </div>

      <div role="tablist" aria-label="Filter products" className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={filter === t.key}
            onClick={() => {
              setFilter(t.key)
              setPage(1)
            }}
            className={
              filter === t.key
                ? 'rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white'
                : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200'
            }
          >
            {`${t.label}${t.n !== undefined ? ` (${t.n})` : ''}`}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-100">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2">Skip</th>
            </tr>
          </thead>
          <tbody>
            {(rows.data?.rows ?? []).map((r) => (
              <PreviewRow
                key={r.id}
                row={r}
                busy={edit.isPending}
                onEdit={(e) => edit.mutate({ rows: [{ id: r.id, ...e }] })}
              />
            ))}
            {rows.data && rows.data.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  Nothing in this list.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.data && rows.data.total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <AppButton
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </AppButton>
          <span>{`Page ${page} of ${Math.ceil(rows.data.total / PAGE_SIZE)}`}</span>
          <AppButton
            size="sm"
            variant="outline"
            disabled={page * PAGE_SIZE >= rows.data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </AppButton>
        </div>
      )}

      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white/95 py-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-slate-600">
          {(counts?.conflict ?? 0) > 0
            ? 'Rows that need attention are left out unless you rename or skip them.'
            : 'Review the list, then import.'}
        </p>
        <AppButton onClick={() => apply.mutate()} disabled={apply.isPending || toImport === 0}>
          {toImport === 0 ? 'Nothing to import' : `Import ${toImport} products`}
        </AppButton>
      </div>
    </div>
  )
}

function PreviewRow({
  row,
  busy,
  onEdit,
}: {
  row: ImportRow
  busy: boolean
  onEdit: (e: {
    skipped?: boolean
    nameOverride?: string | null
    chosenClass?: FulfillmentClass | null
  }) => void
}) {
  const [rename, setRename] = useState(row.nameOverride ?? '')
  const canRename = row.action === 'CONFLICT' || !!row.nameOverride
  const classValue = row.chosenClass ?? NONE
  return (
    <tr className="border-t border-slate-100 align-top" data-testid="import-row">
      <td className="px-3 py-2">
        <div className="flex gap-2">
          {row.imageSourceUrl ? (
            // External preview only; the import re-hosts the photo.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.imageSourceUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-10 w-10 shrink-0 rounded-lg border border-slate-100 object-cover"
            />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{row.nameOverride ?? row.name}</p>
            {row.sourceCategory && <p className="text-xs text-slate-500">{row.sourceCategory}</p>}
            {row.rxLike && (
              <p className="text-xs font-medium text-violet-700">Looks like a prescription item</p>
            )}
            {canRename && (
              <div className="mt-1 flex gap-1">
                <AppInput
                  id={`rename-${row.id}`}
                  aria-label={`New name for ${row.name}`}
                  className="h-8 text-xs"
                  placeholder="New name"
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                />
                <AppButton
                  size="sm"
                  variant="outline"
                  disabled={busy || rename.trim() === (row.nameOverride ?? '')}
                  onClick={() => onEdit({ nameOverride: rename.trim() || null })}
                >
                  Rename
                </AppButton>
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-slate-600">{row.sku ?? '-'}</td>
      <td className="px-3 py-2">
        {row.diff?.price
          ? `${money(row.diff.price.from)} to ${money(row.diff.price.to)}`
          : money(row.price)}
      </td>
      <td className="px-3 py-2">
        {row.diff?.stock
          ? `${row.diff.stock.from ?? 'untracked'} to ${row.diff.stock.to}`
          : (row.stock ?? 'untracked')}
      </td>
      <td className="px-3 py-2">
        <AppBadge variant={row.skipped ? 'neutral' : ACTION_VARIANT[row.action]}>
          {row.skipped ? 'Skipped' : ACTION_LABELS[row.action]}
        </AppBadge>
        {row.error && !row.skipped && (
          <p className="mt-1 max-w-[16rem] text-xs text-slate-600">{row.error}</p>
        )}
        {row.matchedBy && row.action !== 'CONFLICT' && (
          <p className="mt-1 text-xs text-slate-500">
            {row.matchedBy === 'EXTERNAL_ID'
              ? 'Imported before'
              : row.matchedBy === 'SKU'
                ? 'Matched by SKU'
                : 'Matched by name'}
          </p>
        )}
        {row.diff?.imageSkipped && (
          <p className="mt-1 text-xs text-amber-700">{row.diff.imageSkipped}</p>
        )}
      </td>
      <td className="px-3 py-2">
        {row.action === 'CREATE' || row.action === 'UPDATE' || row.action === 'UNCHANGED' ? (
          <div className="w-48">
            <AppSelect
              id={`class-${row.id}`}
              value={classValue}
              options={CLASS_OPTIONS}
              disabled={busy}
              onValueChange={(v) =>
                onEdit({ chosenClass: v === NONE ? null : (v as FulfillmentClass) })
              }
            />
            {row.suggestedClass && !row.chosenClass && (
              <p className="mt-1 text-xs text-slate-500">{`Suggested: ${FULFILLMENT_CLASS_LABELS[row.suggestedClass]}`}</p>
            )}
          </div>
        ) : (
          '-'
        )}
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Skip ${row.name}`}
          checked={row.skipped}
          disabled={busy}
          onChange={(e) => onEdit({ skipped: e.target.checked })}
        />
      </td>
    </tr>
  )
}

function ColumnMapper({
  imp,
  file,
  onReplaced,
  onError,
}: {
  imp: CatalogImport
  file: File | null
  onReplaced: (imp: CatalogImport) => void
  onError: (err: unknown) => void
}) {
  const headers = imp.summary.headers ?? []
  const [mapping, setMapping] = useState<ColumnMapping>(imp.columnMapping ?? {})
  const reread = useMutation({
    mutationFn: () => uploadImportFile(file!, { preset: 'generic', mapping }),
    onSuccess: onReplaced,
    onError,
  })
  const options = [
    { value: NONE, label: 'Not in this file' },
    ...headers.map((h) => ({ value: h, label: h })),
  ]
  return (
    <details
      className="rounded-2xl border border-slate-200 bg-white p-4"
      open={!imp.columnMapping?.name}
    >
      <summary className="cursor-pointer text-sm font-medium text-slate-900">
        Columns: check which column holds what
      </summary>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {(Object.keys(FIELD_LABELS) as MappedField[]).map((f) => (
          <AppSelect
            key={f}
            id={`map-${f}`}
            label={FIELD_LABELS[f]}
            value={mapping[f] ?? NONE}
            options={options}
            onValueChange={(v) => setMapping({ ...mapping, [f]: v === NONE ? undefined : v })}
          />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <AppButton
          variant="outline"
          disabled={!file || !mapping.name || reread.isPending}
          onClick={() => reread.mutate()}
        >
          Read the file again with these columns
        </AppButton>
        {!file && (
          <p className="text-xs text-slate-500">Upload the file again to change the columns.</p>
        )}
      </div>
    </details>
  )
}
