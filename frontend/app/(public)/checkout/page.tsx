'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import { StripePaymentForm } from '@/components/StripePaymentForm'
import { useCart, isPayable } from '@/hooks/useCart'
import { useClinicContext } from '@/hooks/useClinicContext'
import { OneClickPay } from '@/components/store/OneClickPay'
import { PrescribedBadge, DecisionButtons } from '@/components/store/CartModal'
import { getOnFile } from '@/lib/rxCartApi'
import { LogIn, ShoppingBag, Package, ShieldCheck, Check, ArrowRight } from 'lucide-react'

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder'
)

const DEFAULT_THEME = '#0F766E'

export default function CheckoutPage() {
  const { cart, isLoading, isAuthenticated, fetchCartItems, setDecision, pendingDecisions } =
    useCart()
  const queryClient = useQueryClient()
  // F5.3: a returning patient's card + address from booking. Same cache key
  // as <OneClickPay>, so this is one request.
  const { data: onFile } = useQuery({
    queryKey: ['carts', 'one-click'],
    queryFn: getOnFile,
    enabled: isAuthenticated,
    staleTime: 30_000,
  })
  const [useDifferentCard, setUseDifferentCard] = useState(false)
  const [isDemoSubmitting, setIsDemoSubmitting] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<null | {
    items: Array<{ name: string; qty: number; price: number }>
    total: number
  }>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  // Clinic context — set when the patient is checking out from inside a
  // clinic-branded site. We can't read the path here (we're at /checkout),
  // so the cart drawer in the clinic site passes the clinic via ?clinic=
  // query param. Falls back to no clinic if unset.
  const clinicQuery = searchParams.get('clinic')
  const clinicCtx = useClinicContextFromQuery(clinicQuery)

  const themeColor = clinicCtx?.themeColor || DEFAULT_THEME
  const clinicHomePath = clinicCtx ? `/clinic/${clinicCtx.routeId}` : '/'
  const storePath = clinicCtx ? `/clinic/${clinicCtx.routeId}/store` : '/store'
  const billingReturnPath = clinicCtx
    ? `/clinic/${clinicCtx.routeId}` // patient hub modal lives there
    : '/?view=billing'
  const appointmentsReturnPath = clinicCtx ? `/clinic/${clinicCtx.routeId}` : '/?view=appointments'

  const handleInitiateCheckout = async () => {
    if (!isAuthenticated) {
      router.push(`/?auth=login&returnUrl=/checkout${clinicQuery ? `?clinic=${clinicQuery}` : ''}`)
      return
    }
    try {
      const res = await api.post('/carts/checkout')
      setClientSecret(res.data.data.clientSecret)
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to initiate checkout')
    }
  }

  const handleDemoPayment = async () => {
    if (isDemoSubmitting) return
    if (!isAuthenticated) {
      router.push(`/?auth=login&returnUrl=/checkout${clinicQuery ? `?clinic=${clinicQuery}` : ''}`)
      return
    }
    try {
      setIsDemoSubmitting(true)
      // Snapshot what the patient bought BEFORE we clear the local cart so
      // we can render the success card.
      const snapshot = {
        items: (cart?.items ?? []).filter(isPayable).map((it: any) => ({
          name:
            it.product?.name ||
            it.package?.name ||
            it.membership?.name ||
            it.service?.name ||
            it.name ||
            'Item',
          qty: it.quantity,
          price: Number(it.unitPrice),
        })),
        total: subtotal,
      }
      await api.post('/carts/checkout-demo')
      await fetchCartItems()
      setConfirmation(snapshot)
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Demo Payment failed')
    } finally {
      setIsDemoSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 space-y-4">
        <div
          className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200"
          style={{ borderTopColor: themeColor }}
        />
        <p className="text-slate-500 font-medium">Loading your items...</p>
      </div>
    )
  }

  // Confirmation: rendered after a successful demo (or real) payment.
  // Lives on /checkout so the patient sees a calm "you're set" screen
  // instead of being immediately bounced to the clinic landing.
  if (confirmation) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-12 sm:py-20">
        <div
          className="overflow-hidden rounded-3xl border bg-white p-8 text-center shadow-sm"
          style={{ borderColor: `${themeColor}30` }}
        >
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-white shadow"
            style={{ backgroundColor: themeColor }}
          >
            <Check className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-black text-slate-900 sm:text-3xl">You're all set!</h1>
          <p className="mt-2 text-sm text-slate-500">
            Payment received{clinicCtx?.clinic ? ` by ${clinicCtx.clinic.name}` : ''}. A receipt is
            on its way to your email.
          </p>

          <ul className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-slate-50/40 text-left">
            {confirmation.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{it.name}</p>
                  <p className="text-xs text-slate-400">
                    Qty {it.qty} × ${it.price.toFixed(2)}
                  </p>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  ${(it.price * it.qty).toFixed(2)}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-bold text-slate-700">Total paid</span>
              <span className="text-base font-black" style={{ color: themeColor }}>
                ${confirmation.total.toFixed(2)}
              </span>
            </li>
          </ul>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => router.push(storePath)}
              className="inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-3 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: themeColor }}
            >
              Keep shopping
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => router.push(clinicHomePath)}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Back to {clinicCtx?.clinic?.name ?? 'home'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="container mx-auto py-24 text-center space-y-6">
        <div className="mx-auto w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center">
          <LogIn className="h-10 w-10 text-slate-300" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900">Your cart is empty</h1>
        <p className="text-slate-500">Looks like you haven't added anything to your cart yet.</p>
        <Button
          onClick={() => router.push(storePath)}
          className="rounded-full px-8 text-white"
          style={{ backgroundColor: themeColor }}
        >
          Go to Store
        </Button>
      </div>
    )
  }

  // Declined prescribed items stay listed but are not charged.
  const subtotal = cart.items
    .filter(isPayable)
    .reduce((sum: number, item: any) => sum + Number(item.unitPrice) * item.quantity, 0)
  const oneClick = isAuthenticated && !!onFile?.eligible && !useDifferentCard

  const handleOneClickPaid = async () => {
    const snapshot = {
      items: cart.items.filter(isPayable).map((it: any) => ({
        name: it.name || it.product?.name || 'Item',
        qty: it.quantity,
        price: Number(it.unitPrice),
      })),
      total: subtotal,
    }
    await fetchCartItems()
    await queryClient.invalidateQueries({ queryKey: ['carts', 'one-click'] })
    setConfirmation(snapshot)
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-12 lg:px-0">
      <div className="mb-8 flex flex-col gap-4 sm:mb-10 md:flex-row md:items-center md:justify-between">
        <h1 className="text-[28px] font-black tracking-tight text-slate-900 sm:text-4xl">
          Review Order
        </h1>
        {clinicCtx?.clinic && (
          <p
            className="text-[12px] font-bold uppercase tracking-widest"
            style={{ color: themeColor }}
          >
            {clinicCtx.clinic.name}
          </p>
        )}
        {!isAuthenticated && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2">
            <LogIn className="h-4 w-4" /> Guest Session
          </div>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="border-none shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="bg-slate-50/50 border-b-0 py-6 px-8">
              <CardTitle className="text-xl font-bold text-slate-900">Items in Cart</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100">
                {cart.items.map((item: any) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 p-5 transition-colors hover:bg-slate-50/50 sm:p-8"
                  >
                    <div className="flex gap-4">
                      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center shrink-0">
                        {item.itemType === 'PRODUCT' ? (
                          <ShoppingBag className="h-8 w-8 text-slate-300" />
                        ) : (
                          <Package className="h-8 w-8 text-slate-300" />
                        )}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 text-lg">
                          {item.itemType === 'PRODUCT'
                            ? item.product?.name
                            : item.itemType === 'PACKAGE'
                              ? item.package?.name
                              : item.itemType === 'MEMBERSHIP'
                                ? item.membership?.name
                                : item.itemType === 'SERVICE'
                                  ? item.service?.name
                                  : item.name || 'Item'}
                        </div>
                        <div className="text-sm text-slate-500 font-medium">
                          Quantity: {item.quantity} × ${Number(item.unitPrice).toFixed(2)}
                        </div>
                        <PrescribedBadge item={item} />
                        <DecisionButtons
                          item={item}
                          accent={themeColor}
                          onDecide={(decision) => setDecision(item.id, decision)}
                        />
                      </div>
                    </div>
                    <div
                      className={`font-black text-xl ${isPayable(item) ? 'text-slate-900' : 'text-slate-400 line-through'}`}
                    >
                      ${(Number(item.unitPrice) * item.quantity).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            className="border-none shadow-xl rounded-[2rem] overflow-hidden text-white"
            style={{ backgroundColor: themeColor }}
          >
            <CardHeader className="p-8 border-none pb-0">
              <CardTitle className="text-white/60 text-sm font-black uppercase tracking-widest">
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-6">
              <div className="flex justify-between items-baseline">
                <span className="text-white/70 font-medium">Subtotal</span>
                <span className="text-2xl font-bold">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-baseline border-t border-white/10 pt-4">
                <span className="text-lg font-bold">Total Due</span>
                <span className="text-4xl font-black text-white">${subtotal.toFixed(2)}</span>
              </div>

              {!isAuthenticated ? (
                <div className="space-y-4 pt-4">
                  <p className="text-xs text-center text-white/60 leading-relaxed font-medium">
                    You are currently a guest. Please sign in to securely finalize your purchase.
                  </p>
                  <Button
                    className="w-full h-14 text-lg rounded-2xl bg-white hover:bg-white/90 font-bold shadow-2xl shadow-black/20"
                    style={{ color: themeColor }}
                    onClick={() =>
                      router.push(
                        `/?auth=login&returnUrl=/checkout${clinicQuery ? `?clinic=${clinicQuery}` : ''}`
                      )
                    }
                  >
                    Login to Checkout
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 pt-4">
                  {oneClick ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl bg-white p-5 text-slate-900">
                        <OneClickPay
                          total={subtotal}
                          pendingDecisions={pendingDecisions}
                          accent={themeColor}
                          onPaid={handleOneClickPaid}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setUseDifferentCard(true)}
                        className="w-full text-center text-xs font-semibold text-white/70 hover:text-white"
                      >
                        Use a different card
                      </button>
                    </div>
                  ) : !clientSecret ? (
                    <div className="space-y-4">
                      <Button
                        className="w-full h-14 text-lg rounded-2xl bg-white hover:bg-white/90 font-bold shadow-2xl shadow-black/20"
                        style={{ color: themeColor }}
                        onClick={handleInitiateCheckout}
                      >
                        Secure Checkout
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full text-white/60 hover:text-white hover:bg-white/5 font-bold"
                        onClick={handleDemoPayment}
                        disabled={isDemoSubmitting}
                      >
                        {isDemoSubmitting ? 'Processing...' : 'Simulate Demo Payment'}
                      </Button>
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl p-6 text-slate-900">
                      <Elements stripe={stripePromise} options={{ clientSecret }}>
                        <StripePaymentForm
                          clientSecret={clientSecret}
                          buttonLabel={`Pay $${subtotal.toFixed(2)}`}
                          onSuccess={async () => {
                            const snapshot = {
                              items: (cart?.items ?? []).filter(isPayable).map((it: any) => ({
                                name:
                                  it.product?.name ||
                                  it.package?.name ||
                                  it.membership?.name ||
                                  it.service?.name ||
                                  it.name ||
                                  'Item',
                                qty: it.quantity,
                                price: Number(it.unitPrice),
                              })),
                              total: subtotal,
                            }
                            await fetchCartItems()
                            setConfirmation(snapshot)
                          }}
                        />
                      </Elements>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 flex items-start gap-4">
            <ShieldCheck className="h-6 w-6 shrink-0" style={{ color: themeColor }} />
            <div>
              <p className="text-sm font-bold text-slate-900">Secure Payment</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Your transaction is encrypted and HIPAA compliant.
              </p>
            </div>
          </div>
          {clinicCtx && (
            <button
              type="button"
              onClick={() => router.push(clinicHomePath)}
              className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              ← Back to {clinicCtx.clinic?.name ?? 'clinic'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────── Local helper ────────────────────────────────

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getClinic } from '@/lib/clinicApi'
import type { Clinic } from '@/lib/types/booking'

/**
 * Reads `?clinic=<slug|cuid>` from the checkout URL and resolves to a
 * Clinic + theme color. Cart drawer on the clinic site appends this so
 * /checkout knows which brand to render.
 */
function useClinicContextFromQuery(idOrSlug: string | null) {
  const { data } = useQuery({
    queryKey: ['clinic', idOrSlug],
    queryFn: () => getClinic(idOrSlug as string),
    enabled: !!idOrSlug,
  })
  if (!idOrSlug) return null
  return {
    clinic: (data ?? null) as Clinic | null,
    themeColor: data?.themeColor?.trim() || DEFAULT_THEME,
    routeId: idOrSlug,
  }
}
