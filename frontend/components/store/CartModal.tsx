'use client'

/**
 * CartModal — slide-in cart panel triggered from the nav / store hero.
 *
 * Separate from the <AuthModal> flow. The shell lives in CartModalProvider
 * so the nav bell icon, product cards, and store hero can all open it via
 * useCartModal().open().
 */

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Minus, Plus, ShoppingBag, Trash2, X, ArrowRight, Stethoscope, Check } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useCart, type CartItem } from '@/hooks/useCart'
import { categorize } from '@/lib/product-categories'
import { OneClickPay } from '@/components/store/OneClickPay'

const DEFAULT_ACCENT = '#0F766E' // teal-700 — matches the Medoflow store

type ClinicCartCtx = { themeColor: string; routeId: string }

type CartModalContextValue = {
  open: boolean
  setOpen: (v: boolean) => void
  clinicCtx: ClinicCartCtx | null
  setClinicCtx: (c: ClinicCartCtx | null) => void
}

const CartModalContext = React.createContext<CartModalContextValue | null>(null)

export function useCartModal() {
  const ctx = React.useContext(CartModalContext)
  if (!ctx) throw new Error('useCartModal must be used inside <CartModalProvider>')
  return {
    /** Open the cart drawer. Pass clinic context to theme the CTA + carry
     *  the routeId through to /checkout (so checkout stays clinic-branded). */
    open: (clinic?: ClinicCartCtx | null) => {
      if (clinic !== undefined) ctx.setClinicCtx(clinic ?? null)
      ctx.setOpen(true)
    },
    close: () => ctx.setOpen(false),
    isOpen: ctx.open,
    /** Imperative setter for cases where another flow seeds the context. */
    setClinicCtx: ctx.setClinicCtx,
  }
}

export function CartModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [clinicCtx, setClinicCtx] = React.useState<ClinicCartCtx | null>(null)
  const value = React.useMemo(() => ({ open, setOpen, clinicCtx, setClinicCtx }), [open, clinicCtx])
  return (
    <CartModalContext.Provider value={value}>
      {children}
      <CartModal open={open} onOpenChange={setOpen} clinicCtx={clinicCtx} />
    </CartModalContext.Provider>
  )
}

function CartModal({
  open,
  onOpenChange,
  clinicCtx,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  clinicCtx: ClinicCartCtx | null
}) {
  const router = useRouter()
  const {
    cart,
    subtotal,
    totalItems,
    updateQuantity,
    removeItem,
    isLoading,
    fetchCartItems,
    setDecision,
    pendingDecisions,
    isAuthenticated,
  } = useCart()
  const queryClient = useQueryClient()
  const accent = clinicCtx?.themeColor || DEFAULT_ACCENT

  // Refetch every time the drawer is opened so items added from another
  // surface (storefront card, product modal) appear immediately even if
  // the underlying useCart instance was mounted before the addition.
  React.useEffect(() => {
    if (open) fetchCartItems()
  }, [open, fetchCartItems])

  const goToCheckout = () => {
    onOpenChange(false)
    const path = clinicCtx?.routeId
      ? `/checkout?clinic=${encodeURIComponent(clinicCtx.routeId)}`
      : '/checkout'
    router.push(path)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-md',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[61] flex max-h-[85vh] w-[96vw] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl bg-white shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            'duration-200'
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: accent }}
              >
                <ShoppingBag className="h-4 w-4" />
              </div>
              <div>
                <DialogPrimitive.Title className="text-[15px] font-semibold text-slate-900">
                  Your cart
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-slate-500">
                  {totalItems === 0 ? 'Empty' : `${totalItems} item${totalItems > 1 ? 's' : ''}`}
                </DialogPrimitive.Description>
              </div>
            </div>
            <DialogPrimitive.Close
              aria-label="Close cart"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {isLoading ? (
              <div className="space-y-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
                ))}
              </div>
            ) : cart.items.length === 0 ? (
              <EmptyCart onBrowse={() => onOpenChange(false)} />
            ) : (
              <ul className="space-y-3">
                {cart.items.map((item) => (
                  <CartRow
                    key={item.id}
                    item={item}
                    onInc={() => updateQuantity(item.id, item.quantity + 1)}
                    onDec={() => updateQuantity(item.id, item.quantity - 1)}
                    onRemove={() => removeItem(item.id)}
                    onDecide={(decision) => setDecision(item.id, decision)}
                    accent={accent}
                  />
                ))}
              </ul>
            )}
          </div>

          {cart.items.length > 0 && (
            <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-5 space-y-4">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-900">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Shipping & taxes</span>
                <span>Calculated at checkout</span>
              </div>
              {isAuthenticated && (
                <OneClickPay
                  compact
                  total={subtotal}
                  pendingDecisions={pendingDecisions}
                  accent={accent}
                  onPaid={async () => {
                    toast.success('Payment complete — your order is confirmed')
                    await fetchCartItems()
                    await queryClient.invalidateQueries({ queryKey: ['carts', 'one-click'] })
                    onOpenChange(false)
                  }}
                />
              )}
              <button
                type="button"
                onClick={goToCheckout}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300"
              >
                {isAuthenticated ? 'Review order' : 'Proceed to checkout'}
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Continue shopping
              </button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function EmptyCart({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <ShoppingBag className="h-6 w-6" />
      </div>
      <p className="mt-5 text-[15px] font-semibold text-slate-900">Your cart is empty</p>
      <p className="mt-1 max-w-[240px] text-xs text-slate-500">
        Browse physician-curated products, memberships, and care packages.
      </p>
      <Link
        href="/store"
        onClick={onBrowse}
        className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:border-slate-300"
      >
        Explore the store
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

/** "Prescribed · Dr. X" — who sent this item from the visit (F5.2). */
export function PrescribedBadge({ item }: { item: CartItem }) {
  if (!item.rxOrderLineId || !item.prescribedBy) return null
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
      <Stethoscope className="h-3 w-3" />
      Prescribed · Dr. {item.prescribedBy.firstName} {item.prescribedBy.lastName}
    </span>
  )
}

/** Accept / decline for an item a provider prescribed (F5.2). */
export function DecisionButtons({
  item,
  onDecide,
  accent = DEFAULT_ACCENT,
}: {
  item: CartItem
  onDecide: (decision: 'ACCEPTED' | 'DECLINED') => void
  accent?: string
}) {
  if (!item.rxOrderLineId) return null
  if (item.patientDecision === 'PENDING') {
    return (
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onDecide('ACCEPTED')}
          aria-label={`Accept ${item.name}`}
          className="rounded-full px-3 py-1 text-xs font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => onDecide('DECLINED')}
          aria-label={`Decline ${item.name}`}
          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300"
        >
          Decline
        </button>
      </div>
    )
  }
  const accepted = item.patientDecision === 'ACCEPTED'
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span
        className={accepted ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-500'}
      >
        {accepted ? (
          <>
            <Check className="mr-1 inline h-3 w-3" />
            Accepted
          </>
        ) : (
          'Declined — not charged'
        )}
      </span>
      <button
        type="button"
        onClick={() => onDecide(accepted ? 'DECLINED' : 'ACCEPTED')}
        className="text-slate-400 underline hover:text-slate-700"
      >
        {accepted ? 'Decline instead' : 'Accept instead'}
      </button>
    </div>
  )
}

function CartRow({
  item,
  onInc,
  onDec,
  onRemove,
  onDecide,
  accent,
}: {
  item: CartItem
  onInc: () => void
  onDec: () => void
  onRemove: () => void
  onDecide: (decision: 'ACCEPTED' | 'DECLINED') => void
  accent: string
}) {
  const cat = categorize(item.name)
  const Icon = cat.icon
  const lineTotal = Number(item.unitPrice) * item.quantity
  const declined = item.patientDecision === 'DECLINED'

  return (
    <li
      className={cn(
        'group flex gap-3 rounded-2xl border border-slate-100 bg-white p-3 transition-colors hover:border-slate-200',
        declined && 'opacity-60'
      )}
    >
      <div
        className={cn(
          'flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br',
          cat.gradient
        )}
      >
        <Icon className="h-6 w-6" style={{ color: cat.accentHex }} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-900">{item.name}</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-400">
              {item.itemType === 'PRODUCT' ? cat.label : item.itemType.toLowerCase()}
            </p>
            <PrescribedBadge item={item} />
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.name}`}
            className="text-slate-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <QuantityStepper value={item.quantity} onInc={onInc} onDec={onDec} size="sm" />
          <span
            className={cn('text-[13px] font-semibold text-slate-900', declined && 'line-through')}
          >
            ${lineTotal.toFixed(2)}
          </span>
        </div>
        <DecisionButtons item={item} onDecide={onDecide} accent={accent} />
      </div>
    </li>
  )
}

export function QuantityStepper({
  value,
  onInc,
  onDec,
  size = 'md',
  min = 1,
  max = 99,
}: {
  value: number
  onInc: () => void
  onDec: () => void
  size?: 'sm' | 'md'
  min?: number
  max?: number
}) {
  const dims = size === 'sm' ? 'h-7 text-xs' : 'h-10 text-sm'
  const btn = size === 'sm' ? 'h-7 w-7' : 'h-10 w-10'
  return (
    <div
      className={cn('inline-flex items-center rounded-full border border-slate-200 bg-white', dims)}
    >
      <button
        type="button"
        onClick={onDec}
        disabled={value <= min}
        aria-label="Decrease quantity"
        className={cn(
          btn,
          'flex items-center justify-center rounded-full text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40'
        )}
      >
        <Minus className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>
      <span className="min-w-[28px] text-center font-semibold text-slate-900 tabular-nums">
        {value}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={value >= max}
        aria-label="Increase quantity"
        className={cn(
          btn,
          'flex items-center justify-center rounded-full text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40'
        )}
      >
        <Plus className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>
    </div>
  )
}
