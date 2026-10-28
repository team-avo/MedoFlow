'use client'

/**
 * ProductDetailModal — hero + details + "you might also like".
 *
 * Shape:
 *   • Left panel  — gradient visual (category-themed) + price badge.
 *   • Right panel — name, category chip, description, benefit bullets,
 *                   quantity stepper, Add to cart CTA, trust chips.
 *   • Bottom ribbon — up to 4 related products in the same category,
 *     clicking a card swaps the modal content without closing/reopening.
 *
 * The provider exposes an `open(product, allProducts)` signature so any
 * product tile across the app can trigger it.
 */

import React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { CheckCircle2, ShieldCheck, Truck, X, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCart } from '@/hooks/useCart'
import { useCartModal } from './CartModal'
import { QuantityStepper } from './CartModal'
import { categorize, deriveBenefits } from '@/lib/product-categories'

export type StoreProduct = {
  id: string
  name: string
  description?: string | null
  price: number | string
  sku?: string | null
  inventoryItem?: { quantityInStock?: number } | null
}

type ProductDetailContextValue = {
  open: (product: StoreProduct, pool?: StoreProduct[]) => void
}

const ProductDetailContext = React.createContext<ProductDetailContextValue | null>(null)

export function useProductDetail() {
  const ctx = React.useContext(ProductDetailContext)
  if (!ctx) throw new Error('useProductDetail must be used inside <ProductDetailProvider>')
  return ctx
}

export function ProductDetailProvider({ children }: { children: React.ReactNode }) {
  const [product, setProduct] = React.useState<StoreProduct | null>(null)
  const [pool, setPool] = React.useState<StoreProduct[]>([])
  const [isOpen, setIsOpen] = React.useState(false)

  const value = React.useMemo<ProductDetailContextValue>(
    () => ({
      open: (p, allProducts) => {
        setProduct(p)
        setPool(allProducts ?? [])
        setIsOpen(true)
      },
    }),
    []
  )

  return (
    <ProductDetailContext.Provider value={value}>
      {children}
      <ProductDetailDialog
        product={product}
        pool={pool}
        open={isOpen}
        onOpenChange={setIsOpen}
        swapProduct={setProduct}
      />
    </ProductDetailContext.Provider>
  )
}

function ProductDetailDialog({
  product,
  pool,
  open,
  onOpenChange,
  swapProduct,
}: {
  product: StoreProduct | null
  pool: StoreProduct[]
  open: boolean
  onOpenChange: (v: boolean) => void
  swapProduct: (p: StoreProduct) => void
}) {
  const { addToCart } = useCart()
  const cartModal = useCartModal()
  const [qty, setQty] = React.useState(1)

  // Reset qty whenever the active product changes.
  React.useEffect(() => {
    setQty(1)
  }, [product?.id])

  if (!product) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal />
      </DialogPrimitive.Root>
    )
  }

  const cat = categorize(product.name)
  const Icon = cat.icon
  const price = Number(product.price)
  const benefits = deriveBenefits(product.description, 4)
  const inStock = product.inventoryItem?.quantityInStock ?? null

  const related = pool
    .filter((p) => p.id !== product.id && categorize(p.name).id === cat.id)
    .slice(0, 4)
  const fallback = pool.filter((p) => p.id !== product.id).slice(0, 4)
  const relatedList = related.length > 0 ? related : fallback
  const isRealRelated = related.length > 0

  const handleAdd = async () => {
    await addToCart(product, 'PRODUCT', qty)
    onOpenChange(false)
    // Small delay so the close + open feels intentional, not flicker.
    setTimeout(() => cartModal.open(), 180)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-slate-900/60',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[61] flex max-h-[92vh] w-[96vw] max-w-[1040px]',
            '-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] bg-white',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            // Fade only; the slide pair re-applies the -50% centring that the
            // enter/exit keyframes would otherwise reset (no visible movement).
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-1/2'
          )}
          style={{ boxShadow: '0 40px 80px -20px rgba(15, 23, 42, 0.35)' }}
        >
          <DialogPrimitive.Close
            aria-label="Close product"
            className="absolute right-5 top-5 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>

          <div className="overflow-y-auto">
            {/* Hero */}
            <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div
                className={cn(
                  'relative flex min-h-[260px] items-center justify-center bg-gradient-to-br p-10 md:min-h-[440px]',
                  cat.gradient
                )}
              >
                <div className="absolute left-6 top-6 flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ring-1',
                      cat.accent
                    )}
                  >
                    <Tag className="h-3 w-3" />
                    {cat.label}
                  </span>
                </div>
                <div className="flex h-40 w-40 items-center justify-center rounded-full bg-white shadow-inner ring-1 ring-white md:h-52 md:w-52">
                  <Icon
                    className="h-20 w-20 md:h-28 md:w-28"
                    style={{ color: cat.accentHex }}
                    strokeWidth={1.25}
                  />
                </div>
                <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
                  <div className="rounded-2xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-white">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      From
                    </p>
                    <p className="text-xl font-black text-slate-900">${price.toFixed(2)}</p>
                  </div>
                  {product.sku && (
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      {product.sku}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col p-7 md:p-10">
                <DialogPrimitive.Title asChild>
                  <h2 className="text-[22px] font-bold leading-tight text-slate-900 md:text-[26px]">
                    {product.name}
                  </h2>
                </DialogPrimitive.Title>
                <p className="mt-1 text-sm font-medium text-slate-500">{cat.tagline}</p>

                <DialogPrimitive.Description asChild>
                  <p className="mt-5 text-[14px] leading-relaxed text-slate-600">
                    {product.description ??
                      'A clinician-curated product from your MedoFlow clinic store.'}
                  </p>
                </DialogPrimitive.Description>

                {benefits.length > 1 && (
                  <ul className="mt-5 space-y-2.5">
                    {benefits.slice(1).map((b, i) => (
                      <li key={i} className="flex gap-2.5 text-[13px] text-slate-700">
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0"
                          style={{ color: cat.accentHex }}
                          strokeWidth={2}
                        />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-7 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                        Quantity
                      </p>
                      <p className="mt-1 text-[12px] text-slate-500">
                        {inStock === null
                          ? 'Ships in 1–2 business days'
                          : inStock > 10
                            ? `In stock — ${inStock} available`
                            : inStock > 0
                              ? `Low stock — only ${inStock} left`
                              : 'Currently out of stock'}
                      </p>
                    </div>
                    <QuantityStepper
                      value={qty}
                      onInc={() => setQty((v) => Math.min(v + 1, 99))}
                      onDec={() => setQty((v) => Math.max(v - 1, 1))}
                    />
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[12px] text-slate-500">Line total</span>
                    <span className="text-lg font-black text-slate-900">
                      ${(price * qty).toFixed(2)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={inStock === 0}
                    className="mt-4 w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {inStock === 0 ? 'Out of stock' : `Add ${qty} to cart`}
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 text-[11px] text-slate-500">
                  <div className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
                    <ShieldCheck className="h-4 w-4 text-teal-600" strokeWidth={1.75} />
                    <span className="font-medium">Clinician vetted</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
                    <Truck className="h-4 w-4 text-teal-600" strokeWidth={1.75} />
                    <span className="font-medium">Free shipping over $75</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Related products */}
            {relatedList.length > 0 && (
              <div className="border-t border-slate-100 bg-slate-50/60 px-7 py-8 md:px-10">
                <div className="mb-5 flex items-end justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                      You might also like
                    </p>
                    <h3 className="mt-1 text-[17px] font-bold text-slate-900">
                      {isRealRelated ? `More from ${cat.label}` : 'Picks from your care team'}
                    </h3>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {relatedList.map((rp) => (
                    <RelatedCard key={rp.id} product={rp} onClick={() => swapProduct(rp)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function RelatedCard({ product, onClick }: { product: StoreProduct; onClick: () => void }) {
  const cat = categorize(product.name)
  const Icon = cat.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className="group overflow-hidden rounded-2xl border border-slate-100 bg-white text-left transition-colors hover:border-slate-200 hover:shadow-md"
    >
      <div className={cn('flex h-24 items-center justify-center bg-gradient-to-br', cat.gradient)}>
        <Icon
          className="h-10 w-10 transition-transform"
          style={{ color: cat.accentHex }}
          strokeWidth={1.5}
        />
      </div>
      <div className="p-3">
        <p className="line-clamp-2 text-[12px] font-semibold text-slate-900">{product.name}</p>
        <p className="mt-1 text-[13px] font-bold text-slate-900">
          ${Number(product.price).toFixed(2)}
        </p>
      </div>
    </button>
  )
}
