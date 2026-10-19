'use client'

/**
 * F5.2 / F5.3 — "Pay with card on file".
 *
 * For a returning patient the card and shipping address saved at booking
 * are shown read-only ("on file from booking") and the order is paid in one
 * action — no card or address fields. A decline is a recoverable state.
 * When nothing is on file this renders `fallback` (the regular checkout).
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CreditCard, MapPin, Loader2, Zap } from 'lucide-react'
import {
  apiErrorOf,
  cardLabel,
  getOnFile,
  oneClickCheckout,
  type OneClickResult,
  type ShippingAddress,
} from '@/lib/rxCartApi'

interface Props {
  total: number
  /** Prescribed items still waiting for accept / decline. */
  pendingDecisions: number
  accent?: string
  onPaid: (result: OneClickResult) => void | Promise<void>
  /** Rendered when no card / address is on file. */
  fallback?: React.ReactNode
  /** Smaller layout for the cart drawer. */
  compact?: boolean
}

export const formatAddress = (a: ShippingAddress): string =>
  [a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', '), a.postalCode]
    .filter(Boolean)
    .join(' · ')

export function OneClickPay({
  total,
  pendingDecisions,
  accent = '#0F766E',
  onPaid,
  fallback = null,
  compact = false,
}: Props) {
  const { data: onFile, isLoading } = useQuery({
    queryKey: ['carts', 'one-click'],
    queryFn: getOnFile,
    staleTime: 30_000,
  })
  const [paying, setPaying] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }
  if (!onFile?.eligible || !onFile.card || !onFile.shippingAddress) return <>{fallback}</>

  const blocked = pendingDecisions > 0

  const pay = async () => {
    setError(null)
    setPaying(true)
    try {
      const result = await oneClickCheckout()
      await onPaid(result)
    } catch (err) {
      setError(apiErrorOf(err).message)
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="space-y-3" data-testid="one-click-pay">
      <ul
        aria-label="On file from booking"
        className={
          compact
            ? 'space-y-1.5 text-xs text-slate-600'
            : 'space-y-2 rounded-2xl bg-white p-4 text-sm text-slate-700'
        }
      >
        <li className="flex items-start gap-2">
          <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div>
            <span className="font-semibold text-slate-900">Ships to </span>
            {formatAddress(onFile.shippingAddress)}
            <span className="block text-[11px] text-slate-600">On file from booking</span>
          </div>
        </li>
        <li className="flex items-start gap-2">
          <CreditCard aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div>
            <span className="sr-only">Card: </span>
            <span className="font-semibold text-slate-900">{cardLabel(onFile.card)}</span>
            <span className="block text-[11px] text-slate-600">On file from booking</span>
          </div>
        </li>
      </ul>

      {blocked && (
        <p className="text-xs font-medium text-amber-700">
          Accept or decline the items your provider prescribed first.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={pay}
        disabled={paying || blocked}
        className="flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ backgroundColor: accent }}
      >
        {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        {paying ? 'Paying…' : `Pay $${total.toFixed(2)} with card on file`}
      </button>
    </div>
  )
}
