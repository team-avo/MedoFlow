'use client'

/**
 * F5.1 — the products the AI scribe detected in this visit, as removable
 * chips the provider confirms before "Approve & send".
 *
 *  - matched items are chips: name × quantity, a route badge ("Cart" or
 *    "e-Prescribe") and a remove / restore button;
 *  - items the catalog could not match are listed separately and can be
 *    mapped to a product — they are never hidden;
 *  - nothing is sent until the provider ticks the confirmation.
 *
 * The parent owns the approve button; this panel reports what would be sent
 * through `onSelectionChange`.
 */
import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pill, ShoppingCart, X, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  getCatalog,
  getProposal,
  updateProposalLines,
  apiErrorOf,
  type RxLine,
} from '@/lib/rxCartApi'
import { cn } from '@/lib/utils'

export interface RxSelection {
  proposalId: string
  confirmedLineIds: string[]
  /** The provider ticked "I confirm these products for this patient". */
  acknowledged: boolean
}

interface Props {
  sessionId: string
  /** Lock the panel while the note is being approved. */
  disabled?: boolean
  onSelectionChange: (selection: RxSelection | null) => void
}

const money = (v: string | number) => `$${Number(v).toFixed(2)}`

export function DetectedProductsPanel({ sessionId, disabled, onSelectionChange }: Props) {
  const queryClient = useQueryClient()
  const key = ['rx-cart', 'proposal', sessionId]
  const { data: proposal, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getProposal(sessionId),
  })
  const [removed, setRemoved] = React.useState<Set<string>>(new Set())
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const lines = React.useMemo(() => proposal?.lines ?? [], [proposal])
  const chips = lines.filter((l) => l.route !== 'MANUAL' && l.matchedProduct)
  const unmapped = lines.filter((l) => l.route === 'MANUAL' || !l.matchedProduct)
  const pending = proposal?.status === 'PENDING'

  const { data: catalog = [] } = useQuery({
    queryKey: ['rx-cart', 'catalog'],
    queryFn: getCatalog,
    enabled: pending && lines.length > 0,
  })

  const mapMutation = useMutation({
    mutationFn: (v: { lineId: string; productId: string }) =>
      updateProposalLines(proposal!.id, { lines: [{ id: v.lineId, productId: v.productId }] }),
    onSuccess: (updated) => {
      setError(null)
      queryClient.setQueryData(key, updated)
    },
    onError: (err) => setError(apiErrorOf(err).message),
  })

  const confirmedLineIds = React.useMemo(
    () => chips.filter((l) => !removed.has(l.id)).map((l) => l.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, removed]
  )

  React.useEffect(() => {
    if (!proposal || !pending || lines.length === 0) {
      onSelectionChange(null)
      return
    }
    onSelectionChange({ proposalId: proposal.id, confirmedLineIds, acknowledged })
  }, [proposal, pending, lines.length, confirmedLineIds, acknowledged, onSelectionChange])

  const toggle = (id: string) => {
    setAcknowledged(false) // a changed selection needs a fresh confirmation
    setRemoved((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (isLoading || !proposal || lines.length === 0) return null

  if (!pending) {
    const sent = lines.filter((l) => l.decision === 'CONFIRMED')
    return (
      <section
        aria-label="Products sent"
        className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5"
      >
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
          <CheckCircle2 className="h-4 w-4" />
          {sent.length === 0
            ? 'No products were sent for this visit'
            : `Sent: ${sent.filter((l) => l.route === 'CART').length} to the patient's cart, ${
                sent.filter((l) => l.route === 'EPRESCRIBE').length
              } to e-prescribe`}
        </p>
      </section>
    )
  }

  const toCart = chips.filter((l) => !removed.has(l.id) && l.route === 'CART').length
  const toRx = chips.filter((l) => !removed.has(l.id) && l.route === 'EPRESCRIBE').length

  return (
    <section
      aria-label="Detected products"
      className="space-y-4 rounded-2xl border border-indigo-200 bg-white p-5"
    >
      <div>
        <h3 className="text-sm font-bold text-slate-900">Detected products</h3>
        <p className="text-xs text-slate-500">
          From this conversation. Remove anything you did not prescribe — only what is left is sent
          when you approve.
        </p>
      </div>

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Products to send">
          {chips.map((line) => (
            <Chip
              key={line.id}
              line={line}
              removed={removed.has(line.id)}
              disabled={disabled}
              onToggle={() => toggle(line.id)}
            />
          ))}
        </ul>
      )}

      {unmapped.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" />
            Not matched to your catalog — map it to a product, or it will not be sent
          </p>
          <ul className="space-y-2">
            {unmapped.map((line) => (
              <li key={line.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-800">
                  {line.rawText}
                  {line.dose ? ` ${line.dose}` : ''} × {line.quantity}
                </span>
                <label className="sr-only" htmlFor={`map-${line.id}`}>
                  Map {line.rawText} to a product
                </label>
                <select
                  id={`map-${line.id}`}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                  defaultValue=""
                  disabled={disabled || mapMutation.isPending}
                  onChange={(e) => {
                    if (e.target.value) {
                      setAcknowledged(false)
                      mapMutation.mutate({ lineId: line.id, productId: e.target.value })
                    }
                  }}
                >
                  <option value="">Choose a product…</option>
                  {catalog.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {money(p.price)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-500" data-testid="rx-send-summary">
          On approval: {toCart} to the patient&apos;s cart
          {toRx > 0 ? `, ${toRx} to e-prescribe (never the cart)` : ''}.
        </p>
        <label className="flex items-start gap-2 text-sm font-medium text-slate-800">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
            checked={acknowledged}
            disabled={disabled}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          I confirm these products for this patient
        </label>
      </div>
    </section>
  )
}

function Chip({
  line,
  removed,
  disabled,
  onToggle,
}: {
  line: RxLine
  removed: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  const name = line.matchedProduct!.name
  const rx = line.route === 'EPRESCRIBE'
  return (
    <li
      className={cn(
        'inline-flex items-center gap-2 rounded-full border py-1 pl-3 pr-1 text-xs',
        removed
          ? 'border-slate-300 bg-white text-slate-600 line-through'
          : rx
            ? 'border-violet-200 bg-violet-50 text-violet-900'
            : 'border-indigo-200 bg-indigo-50 text-indigo-900'
      )}
    >
      {rx ? <Pill className="h-3.5 w-3.5" /> : <ShoppingCart className="h-3.5 w-3.5" />}
      <span className="font-semibold">
        {name}
        {line.dose ? ` · ${line.dose}` : ''} × {line.quantity}
      </span>
      <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide no-underline">
        {rx ? 'e-Prescribe' : 'Cart'}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={removed ? `Restore ${name}` : `Remove ${name}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white disabled:opacity-50"
      >
        {removed ? <RotateCcw className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </button>
    </li>
  )
}

/** The payload for "Approve & send", or why it cannot be sent yet. */
export function rxApproval(selection: RxSelection | null):
  | {
      ok: true
      rxConfirmation?: { proposalId: string; confirmedLineIds: string[]; acknowledged: true }
    }
  | { ok: false; reason: string } {
  if (!selection) return { ok: true }
  if (!selection.acknowledged) {
    return { ok: false, reason: 'Confirm the detected products before sending' }
  }
  return {
    ok: true,
    rxConfirmation: {
      proposalId: selection.proposalId,
      confirmedLineIds: selection.confirmedLineIds,
      acknowledged: true,
    },
  }
}
