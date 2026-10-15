'use client'

/**
 * /store — clinic storefront.
 *
 * Layout (top-down):
 *   1. Navy hero with store intro + search + trust row.
 *   2. Category chip rail (scrolls by letter, filters the grid live).
 *   3. Featured ribbon — three hero products from the most-stocked category.
 *   4. Main product grid (filtered by the active chip).
 *   5. Care packages strip.
 *   6. Memberships strip.
 *   7. Physician assurance band.
 *
 * Interaction:
 *   • Card click opens <ProductDetailModal> (hero + qty stepper + related).
 *   • Add to cart triggers <CartModal> via useCartModal().
 *   • Search runs client-side on name + description.
 */

import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useCart } from '@/hooks/useCart'
import {
  getClinics,
  getPublicClinicProducts,
  getPublicClinicPackages,
  getPublicClinicMemberships,
} from '@/lib/clinicApi'
import {
  ArrowRight,
  CheckCircle2,
  Package as PackageIcon,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Tags,
  Truck,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { categorize, CATEGORIES, type CategoryId } from '@/lib/product-categories'
import { useProductDetail, type StoreProduct } from '@/components/store/ProductDetailModal'
import { useCartModal } from '@/components/store/CartModal'
import { clientLog } from '@/lib/clientLog'

type PackageT = {
  id: string
  name: string
  description?: string | null
  price: number | string
  totalSessions?: number | null
  expiresInDays?: number | null
}

type MembershipT = {
  id: string
  name: string
  description?: string | null
  monthlyPrice: number | string
  billingPeriod: string
  serviceDiscountPercent: number
}

export default function StorePage() {
  const { user, isAuthenticated } = useAuth()
  const { addToCart } = useCart()
  const productDetail = useProductDetail()
  const cartModal = useCartModal()

  const [products, setProducts] = React.useState<StoreProduct[]>([])
  const [packages, setPackages] = React.useState<PackageT[]>([])
  const [memberships, setMemberships] = React.useState<MembershipT[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [activeCategory, setActiveCategory] = React.useState<'all' | CategoryId>('all')
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const clinics = await getClinics()
        const mainClinic = clinics?.[0]
        if (!mainClinic) {
          if (!cancelled) setIsLoading(false)
          return
        }
        const [prodRes, packRes, memRes] = await Promise.all([
          getPublicClinicProducts(mainClinic.id),
          getPublicClinicPackages(mainClinic.id),
          getPublicClinicMemberships(mainClinic.id),
        ])
        if (cancelled) return
        setProducts(prodRes)
        setPackages(packRes)
        setMemberships(memRes)
      } catch (err) {
        clientLog.error('Failed to fetch catalog', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const presentCategories = React.useMemo(() => {
    const set = new Set<CategoryId>()
    for (const p of products) set.add(categorize(p.name).id)
    return Array.from(set)
  }, [products])

  const filteredProducts = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      if (activeCategory !== 'all' && categorize(p.name).id !== activeCategory) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)
    })
  }, [products, query, activeCategory])

  const featured = React.useMemo(() => products.slice(0, 3), [products])

  const firstName = user?.name?.split(' ').find((p) => !/^(dr|mr|ms|mrs|prof)\.?$/i.test(p))

  return (
    <div className="min-h-screen bg-canvas">
      {/* 1. Hero */}
      <section className="relative overflow-hidden bg-navy text-white">
        <div className="absolute inset-0 mf-grid-pattern opacity-30" aria-hidden />
        <div
          className="pointer-events-none absolute -top-40 -right-24 h-96 w-96 rounded-full blur-[140px]"
          style={{ backgroundColor: 'rgba(13, 148, 136, 0.35)' }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-7xl px-6 pt-16 pb-24 lg:pt-20 lg:pb-28">
          <div className="max-w-2xl">
            {isAuthenticated && firstName && (
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-teal-bright backdrop-blur-sm">
                <Sparkles className="h-3 w-3" />
                Welcome back, {firstName}
              </div>
            )}
            <h1 className="mf-display text-4xl leading-tight sm:text-5xl lg:text-6xl">
              The clinic store, <span className="text-teal-bright">built by your care team.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/70">
              Physician-vetted supplements, recovery essentials, and home diagnostics — curated for
              your plan of care and shipped to your door.
            </p>

            <div className="mt-8 flex max-w-xl items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 backdrop-blur-sm">
              <Search className="h-4 w-4 text-white/60" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search supplements, recovery, skincare…"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-white/50 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="rounded-full px-2 py-1 text-[11px] font-semibold text-white/60 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-white/70">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-teal-bright" strokeWidth={1.75} /> FDA-aligned
                sourcing
              </span>
              <span className="flex items-center gap-1.5">
                <Truck className="h-4 w-4 text-teal-bright" strokeWidth={1.75} /> Free shipping over
                $75
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-teal-bright" strokeWidth={1.75} /> 2,400+ clinics
                trust us
              </span>
            </div>
          </div>
        </div>

        {/* Wave separator into canvas */}
        <div
          className="absolute bottom-0 left-0 right-0 h-8 bg-canvas"
          style={{
            clipPath: 'polygon(0 45%, 100% 0, 100% 100%, 0 100%)',
          }}
          aria-hidden
        />
      </section>

      {/* 2. Category rail */}
      <section className="mx-auto max-w-7xl px-6 pt-10">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <CategoryChip
            active={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
            label="All"
            count={products.length}
          />
          {presentCategories.map((id) => {
            const meta = CATEGORIES[id]
            const count = products.filter((p) => categorize(p.name).id === id).length
            return (
              <CategoryChip
                key={id}
                active={activeCategory === id}
                onClick={() => setActiveCategory(id)}
                label={meta.label}
                count={count}
                accentHex={meta.accentHex}
              />
            )
          })}
        </div>
      </section>

      {/* 3. Featured ribbon */}
      {!isLoading && featured.length > 0 && activeCategory === 'all' && !query && (
        <section className="mx-auto max-w-7xl px-6 pt-8">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
                Handpicked this week
              </p>
              <h2 className="mt-1 text-[22px] font-bold text-ink">Featured for your care plan</h2>
            </div>
            <button
              type="button"
              onClick={() => cartModal.open()}
              className="hidden text-[12px] font-semibold text-teal hover:text-teal-hover md:inline-flex"
            >
              View cart →
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {featured.map((p) => (
              <FeaturedCard
                key={p.id}
                product={p}
                onOpen={() => productDetail.open(p, products)}
                onQuickAdd={() => addToCart(p, 'PRODUCT')}
              />
            ))}
          </div>
        </section>
      )}

      {/* 4. Main product grid */}
      <section className="mx-auto max-w-7xl px-6 pt-10 pb-16">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
              Catalogue
            </p>
            <h2 className="mt-1 text-[22px] font-bold text-ink">
              {activeCategory === 'all'
                ? 'All products'
                : CATEGORIES[activeCategory as CategoryId].label}
            </h2>
          </div>
          <span className="text-[12px] text-ink-muted">{filteredProducts.length} items</span>
        </div>

        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="h-80 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-20 text-center">
            <p className="font-medium text-slate-500">No products match that search.</p>
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setActiveCategory('all')
              }}
              className="mt-4 text-[12px] font-semibold text-teal hover:text-teal-hover"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onOpen={() => productDetail.open(p, products)}
                onQuickAdd={() => addToCart(p, 'PRODUCT')}
              />
            ))}
          </div>
        )}
      </section>

      {/* 5. Care packages */}
      {packages.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 pb-16">
          <SectionHeader
            eyebrow="Care packages"
            title="Prepaid sessions at clinic-loyal rates"
            subtitle="Bundle visits for structured rehab, performance, or longevity journeys."
          />
          <div className="grid gap-4 md:grid-cols-3">
            {packages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onAdd={async () => {
                  await addToCart(pkg, 'PACKAGE')
                  cartModal.open()
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* 6. Memberships */}
      {memberships.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 pb-20">
          <SectionHeader
            eyebrow="Memberships"
            title="One clinic. Unlimited support."
            subtitle="Priority booking, ongoing discounts, and a care coordinator on your side."
          />
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {memberships.map((m, idx) => (
              <MembershipCard
                key={m.id}
                plan={m}
                highlighted={idx === memberships.length - 1}
                onAdd={async () => {
                  await addToCart(m, 'MEMBERSHIP')
                  cartModal.open()
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* 7. Physician assurance band */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-[28px] bg-navy p-10 text-white md:p-14">
          <div className="absolute inset-0 mf-grid-pattern opacity-20" aria-hidden />
          <div
            className="pointer-events-none absolute -bottom-20 -right-12 h-72 w-72 rounded-full blur-[120px]"
            style={{ backgroundColor: 'rgba(13, 148, 136, 0.3)' }}
            aria-hidden
          />
          <div className="relative grid items-center gap-10 md:grid-cols-2">
            <div>
              <div className="flex items-center gap-1 text-amber-300">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
                <span className="ml-2 text-[12px] font-medium text-white/70">
                  Trusted by 2,400+ USA clinics
                </span>
              </div>
              <h2 className="mf-display mt-4 text-3xl leading-tight md:text-4xl">
                Vetted by our medical board.
              </h2>
              <p className="mt-4 max-w-md text-[14px] leading-relaxed text-white/70">
                Every SKU is reviewed by a licensed clinician for sourcing, potency, and interaction
                risk. If it wouldn&rsquo;t pass our pharmacy formulary, it doesn&rsquo;t make the
                shelf.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <AssuranceCell
                icon={ShieldCheck}
                title="HIPAA ready"
                body="Secure purchase history in your chart."
              />
              <AssuranceCell icon={Truck} title="Fast shipping" body="2-day to all 50 states." />
              <AssuranceCell
                icon={CheckCircle2}
                title="Third-party tested"
                body="Lot-level COAs available on request."
              />
              <AssuranceCell
                icon={Users}
                title="Care coordinator"
                body="Questions answered by your clinic."
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// ───────────────────────── Pieces ─────────────────────────

function CategoryChip({
  active,
  onClick,
  label,
  count,
  accentHex,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  accentHex?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[12.5px] font-semibold transition-colors',
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-ink-muted hover:border-slate-300 hover:text-ink'
      )}
      style={
        active && accentHex ? { backgroundColor: accentHex, borderColor: accentHex } : undefined
      }
    >
      {label}
      <span
        className={cn(
          'inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px]',
          active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
        )}
      >
        {count}
      </span>
    </button>
  )
}

function FeaturedCard({
  product,
  onOpen,
  onQuickAdd,
}: {
  product: StoreProduct
  onOpen: () => void
  onQuickAdd: () => void
}) {
  const cat = categorize(product.name)
  const Icon = cat.icon
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' ? onOpen() : null)}
      className="group relative cursor-pointer overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100 transition-all hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div
        className={cn(
          'relative flex h-56 items-center justify-center bg-gradient-to-br p-8',
          cat.gradient
        )}
      >
        <Icon
          className="h-28 w-28 transition-transform duration-500 group-hover:scale-110"
          style={{ color: cat.accentHex }}
          strokeWidth={1.15}
        />
        <span
          className={cn(
            'absolute left-5 top-5 inline-flex items-center rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1',
            cat.accent
          )}
        >
          {cat.label}
        </span>
      </div>
      <div className="p-6">
        <h3 className="text-[15px] font-bold leading-tight text-slate-900">{product.name}</h3>
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-slate-600">
          {product.description}
        </p>
        <div className="mt-5 flex items-center justify-between">
          <p className="text-xl font-black text-slate-900">${Number(product.price).toFixed(2)}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onQuickAdd()
            }}
            className="rounded-full bg-slate-900 px-5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Quick add
          </button>
        </div>
      </div>
    </div>
  )
}

function ProductCard({
  product,
  onOpen,
  onQuickAdd,
}: {
  product: StoreProduct
  onOpen: () => void
  onQuickAdd: () => void
}) {
  const cat = categorize(product.name)
  const Icon = cat.icon
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' ? onOpen() : null)}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-200"
    >
      <div
        className={cn(
          'relative flex h-40 items-center justify-center bg-gradient-to-br',
          cat.gradient
        )}
      >
        <Icon
          className="h-16 w-16 transition-transform duration-500 group-hover:scale-110"
          style={{ color: cat.accentHex }}
          strokeWidth={1.25}
        />
        <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-700 ring-1 ring-white backdrop-blur-sm">
          {cat.label}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="line-clamp-2 text-[14px] font-semibold text-slate-900">{product.name}</h3>
        <p className="mt-1.5 line-clamp-2 flex-1 text-[12.5px] leading-relaxed text-slate-500">
          {product.description}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-[17px] font-black text-slate-900">
            ${Number(product.price).toFixed(2)}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onQuickAdd()
            }}
            className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[11.5px] font-semibold text-slate-800 transition-all hover:border-slate-300 hover:bg-slate-900 hover:text-white"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string
  title: string
  subtitle: string
}) {
  return (
    <div className="mb-6 max-w-2xl">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-[22px] font-bold text-ink">{title}</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{subtitle}</p>
    </div>
  )
}

function PackageCard({ pkg, onAdd }: { pkg: PackageT; onAdd: () => void }) {
  return (
    <div className="flex h-full flex-col rounded-3xl bg-white p-7 ring-1 ring-slate-100 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
          <PackageIcon className="h-5 w-5" />
        </div>
        {pkg.totalSessions && (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700">
            {pkg.totalSessions} sessions
          </span>
        )}
      </div>
      <h3 className="mt-5 text-[16px] font-bold text-slate-900">{pkg.name}</h3>
      <p className="mt-2 flex-1 text-[13px] leading-relaxed text-slate-500">{pkg.description}</p>
      <div className="mt-6 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Package price
          </p>
          <p className="mt-0.5 text-2xl font-black text-slate-900">
            ${Number(pkg.price).toFixed(0)}
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Add to cart
        </button>
      </div>
    </div>
  )
}

function MembershipCard({
  plan,
  highlighted,
  onAdd,
}: {
  plan: MembershipT
  highlighted: boolean
  onAdd: () => void
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-3xl p-8 transition-all hover:-translate-y-0.5 hover:shadow-md',
        highlighted
          ? 'bg-navy text-white ring-1 ring-navy'
          : 'bg-white text-slate-900 ring-1 ring-slate-100'
      )}
    >
      {highlighted && (
        <span className="absolute right-6 top-6 inline-flex items-center gap-1 rounded-full bg-teal-bright/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-teal-bright ring-1 ring-teal-bright/30">
          <Sparkles className="h-3 w-3" /> Best value
        </span>
      )}
      <div className="flex items-center gap-2">
        <Tags className={cn('h-5 w-5', highlighted ? 'text-teal-bright' : 'text-teal-600')} />
        <p
          className={cn(
            'text-[11px] font-semibold uppercase tracking-widest',
            highlighted ? 'text-white/70' : 'text-slate-500'
          )}
        >
          Monthly plan
        </p>
      </div>
      <h3 className={cn('mt-4 text-[18px] font-bold')}>{plan.name}</h3>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-4xl font-black">${Number(plan.monthlyPrice).toFixed(0)}</span>
        <span
          className={cn(
            'text-[13px] font-medium',
            highlighted ? 'text-white/60' : 'text-slate-500'
          )}
        >
          / {plan.billingPeriod.toLowerCase()}
        </span>
      </div>
      <p
        className={cn(
          'mt-4 flex-1 text-[13px] leading-relaxed',
          highlighted ? 'text-white/75' : 'text-slate-600'
        )}
      >
        {plan.description}
      </p>
      <ul className="mt-5 space-y-2">
        <Perk highlighted={highlighted}>{plan.serviceDiscountPercent}% off every clinic visit</Perk>
        <Perk highlighted={highlighted}>Priority same-day booking</Perk>
        <Perk highlighted={highlighted}>Dedicated care coordinator</Perk>
      </ul>
      <button
        type="button"
        onClick={onAdd}
        className={cn(
          'mt-7 inline-flex items-center justify-center gap-2 rounded-full py-3 text-[13px] font-semibold transition-colors',
          highlighted
            ? 'bg-teal-bright text-navy hover:bg-white'
            : 'bg-slate-900 text-white hover:bg-slate-800'
        )}
      >
        Choose plan <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function Perk({ highlighted, children }: { highlighted: boolean; children: React.ReactNode }) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 text-[12.5px]',
        highlighted ? 'text-white/85' : 'text-slate-700'
      )}
    >
      <CheckCircle2
        className={cn('h-4 w-4', highlighted ? 'text-teal-bright' : 'text-teal-600')}
        strokeWidth={2}
      />
      {children}
    </li>
  )
}

function AssuranceCell({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon
  title: string
  body: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <Icon className="h-5 w-5 text-teal-bright" strokeWidth={1.75} />
      <p className="mt-4 text-[13px] font-semibold text-white">{title}</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-white/60">{body}</p>
    </div>
  )
}
