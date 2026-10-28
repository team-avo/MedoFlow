'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppButton,
  AppInput,
  AppPageHeader,
  LoadingSkeleton,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import api from '@/lib/api'
import {
  addInvoiceItem,
  createInvoice,
  finalizeInvoice,
  recordManualInvoicePayment,
} from '@/lib/invoiceApi'
import { getPatientEntitlements, type PatientEntitlements } from '@/lib/patientApi'
import { toast } from 'sonner'
import {
  ShoppingCart,
  Trash2,
  Search,
  User,
  Package,
  Activity,
  CreditCard,
  X,
  Receipt,
  Plus,
  Minus,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type CatalogType = 'SERVICE' | 'PRODUCT' | 'PACKAGE'

interface CatalogItem {
  id: string
  name: string
  description?: string
  defaultPrice?: string
  price?: string
  inventoryItem?: { quantityInStock: number }
}

interface CartLine {
  id: string
  itemType: CatalogType
  name: string
  quantity: number
  unitPrice: number
}

const MANUAL_PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CHECK', label: 'Check' },
  { value: 'CARD_PRESENT', label: 'Card (manual)' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'OTHER', label: 'Other' },
]

export default function PointOfSalePage() {
  const [patients, setPatients] = useState<any[]>([])
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [searchQuery, setSearchSearchQuery] = useState('')

  const [products, setProducts] = useState<CatalogItem[]>([])
  const [services, setServices] = useState<CatalogItem[]>([])
  const [packages, setPackages] = useState<CatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)

  const [cart, setCart] = useState<CartLine[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [entitlements, setEntitlements] = useState<PatientEntitlements | null>(null)

  const [collectPaymentNow, setCollectPaymentNow] = useState(true)
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [patientsRes, productsRes, servicesRes, packagesRes] = await Promise.all([
          api.get('/patients'),
          api.get('/products'),
          api.get('/services'),
          api.get('/packages'),
        ])
        setPatients(patientsRes.data.data.patients ?? [])
        setProducts(productsRes.data.data.products ?? [])
        setServices(servicesRes.data.data.services ?? [])
        setPackages(packagesRes.data.data.packages ?? [])
      } catch (error) {
        toast.error('Failed to load front-desk checkout data')
      } finally {
        setCatalogLoading(false)
      }
    }
    fetchData()
  }, [])

  useEffect(() => {
    if (!selectedPatientId) {
      setEntitlements(null)
      return
    }
    getPatientEntitlements(selectedPatientId)
      .then(setEntitlements)
      .catch(() => setEntitlements(null))
  }, [selectedPatientId])

  const addToCart = (item: CatalogItem, itemType: CatalogType) => {
    setCart((current) => {
      const existing = current.find((line) => line.id === item.id && line.itemType === itemType)
      const unitPrice = Number(item.price ?? item.defaultPrice ?? 0)
      if (existing) {
        toast.success(`Increased quantity of ${item.name}`)
        return current.map((line) =>
          line === existing ? { ...line, quantity: line.quantity + 1 } : line
        )
      }
      toast.success(`Added ${item.name} to cart`)
      return [
        ...current,
        {
          id: item.id,
          itemType,
          name: item.name,
          quantity: 1,
          unitPrice,
        },
      ]
    })
  }

  const removeLine = (index: number) => {
    setCart((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }

  const updateQuantity = (index: number, delta: number) => {
    setCart((current) =>
      current.map((line, i) => {
        if (i === index) {
          return { ...line, quantity: Math.max(1, line.quantity + delta) }
        }
        return line
      })
    )
  }

  const subtotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [cart]
  )
  const tax = subtotal * 0.13 // Refactor to dynamic if needed
  const total = subtotal + tax

  const handleCheckout = async () => {
    if (!selectedPatientId) {
      toast.error('Please select a patient first')
      return
    }
    if (cart.length === 0) {
      toast.error('Cart is empty')
      return
    }

    setIsSubmitting(true)
    try {
      const createdInvoice = await createInvoice({ patientId: selectedPatientId })

      for (const line of cart) {
        await addInvoiceItem(createdInvoice.id, {
          itemType: line.itemType,
          itemId: line.id,
          quantity: line.quantity,
          ...(line.itemType !== 'SERVICE' ? { unitPrice: line.unitPrice } : {}),
          description: line.name,
        })
      }

      const finalizedInvoice = await finalizeInvoice(createdInvoice.id)

      if (collectPaymentNow) {
        const amountToCollect =
          paymentAmount.trim().length > 0
            ? Number(paymentAmount)
            : Number(finalizedInvoice.totalAmount)
        await recordManualInvoicePayment(finalizedInvoice.id, {
          amount: amountToCollect,
          paymentMethod,
          notes: paymentNotes.trim() || undefined,
        })
      }

      toast.success(
        collectPaymentNow ? 'Transaction completed and paid' : 'Invoice created and outstanding'
      )
      setCart([])
      setSelectedPatientId('')
      setPaymentAmount('')
      setPaymentNotes('')
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Checkout failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedPatient = patients.find((p) => p.id === selectedPatientId)

  return (
    // On lg+ we lock to h-screen and use dual internal scroll (desktop app feel).
    // On smaller screens we stack and let the page scroll — two tiny scroll
    // panes on a phone is a usability disaster.
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col bg-slate-50 lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
      <div className="border-b bg-white px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <AppPageHeader
          title="Point of Sale"
          description="Direct billing for walk-in services and products."
        />
      </div>

      <div className="flex flex-1 flex-col lg:flex-row lg:overflow-hidden">
        {/* Left side: Catalog Browser */}
        <div className="flex-1 space-y-8 p-4 sm:p-6 lg:space-y-10 lg:overflow-y-auto lg:p-8">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <AppInput
              placeholder="Search catalog..."
              className="pl-10 rounded-full bg-white border-slate-200"
              value={searchQuery}
              onChange={(e) => setSearchSearchQuery(e.target.value)}
            />
          </div>

          {catalogLoading && <LoadingSkeleton variant="card" count={4} />}

          <div className="space-y-6">
            <div className="flex items-center gap-2 text-slate-900 border-b border-slate-100 pb-2">
              <Activity className="h-5 w-5 text-primary-600" />
              <h2 className="text-xl font-bold tracking-tight">Services</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {services
                .filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => addToCart(s, 'SERVICE')}
                    className="group flex flex-col text-left p-5 bg-white rounded-2xl border border-slate-100 hover:border-primary-600 hover:shadow-md transition-colors relative overflow-hidden"
                  >
                    <span className="font-bold text-slate-900 group-hover:text-primary-600 transition-colors truncate w-full">
                      {s.name}
                    </span>
                    <span className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-tighter">
                      Clinical Service
                    </span>
                    <span className="mt-4 font-black text-slate-900">
                      ${Number(s.defaultPrice).toFixed(2)}
                    </span>
                  </button>
                ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-2 text-slate-900 border-b border-slate-100 pb-2">
              <Package className="h-5 w-5 text-primary-600" />
              <h2 className="text-xl font-bold tracking-tight">Products</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {products
                .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p, 'PRODUCT')}
                    className="group flex flex-col text-left p-5 bg-white rounded-2xl border border-slate-100 hover:border-primary-600 hover:shadow-md transition-colors relative"
                  >
                    <span className="font-bold text-slate-900 group-hover:text-primary-600 transition-colors truncate w-full">
                      {p.name}
                    </span>
                    <span className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-tighter">
                      Inventory: {p.inventoryItem?.quantityInStock ?? 0}
                    </span>
                    <span className="mt-4 font-black text-slate-900">
                      ${Number(p.price).toFixed(2)}
                    </span>
                  </button>
                ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-2 text-slate-900 border-b border-slate-100 pb-2">
              <CreditCard className="h-5 w-5 text-primary-600" />
              <h2 className="text-xl font-bold tracking-tight">Packages</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {packages
                .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p, 'PACKAGE')}
                    className="group flex flex-col text-left p-5 bg-white rounded-2xl border border-slate-100 hover:border-primary-600 hover:shadow-md transition-colors"
                  >
                    <span className="font-bold text-slate-900 group-hover:text-primary-600 transition-colors truncate w-full">
                      {p.name}
                    </span>
                    <span className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-tighter">
                      Pre-paid Sessions
                    </span>
                    <span className="mt-4 font-black text-slate-900">
                      ${Number(p.price).toFixed(2)}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* Right side: Operations Sidebar — stacks below catalog on mobile,
            fixed 450-wide column on lg+. */}
        <div className="z-10 flex w-full flex-col border-t border-slate-200 bg-white lg:w-[450px] lg:border-l lg:border-t-0 lg:shadow-lg">
          <div className="p-6 border-b bg-slate-50/50 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <User className="h-4 w-4 text-primary-600" /> Patient
              </h3>
              {selectedPatientId && (
                <button
                  onClick={() => setSelectedPatientId('')}
                  className="text-xs text-rose-600 font-bold hover:underline"
                >
                  Change
                </button>
              )}
            </div>
            <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
              <SelectTrigger className="h-12 rounded-xl bg-white border-slate-200">
                <SelectValue placeholder="Search or select patient..." />
              </SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {entitlements && (
              <div className="p-4 bg-primary-50/50 rounded-2xl border border-primary-100 space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between text-xs font-bold text-primary-700 uppercase tracking-wider">
                  <span>Clinical Entitlements</span>
                  <ShieldCheck className="h-3 w-3" />
                </div>
                {entitlements.activeMembershipBenefit && (
                  <p className="text-sm font-medium text-primary-900">
                    {entitlements.activeMembershipBenefit.membershipName} Member (
                    {Number(entitlements.activeMembershipBenefit.serviceDiscountPercent)}% off)
                  </p>
                )}
                {entitlements.packages.map((pkg) => (
                  <div key={pkg.id} className="text-xs text-primary-600 font-medium">
                    {pkg.package.name}: {Math.max(pkg.totalSessions - pkg.usedSessions, 0)} left
                  </div>
                ))}
                {!entitlements.activeMembershipBenefit && entitlements.packages.length === 0 && (
                  <p className="text-xs text-slate-400">No active plans found.</p>
                )}
              </div>
            )}
          </div>

          {/* Cart Items — scrolls within the sidebar on lg+; natural page scroll on mobile */}
          <div className="flex-1 space-y-4 p-6 lg:overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm uppercase tracking-widest">
                Current Cart ({cart.length})
              </h3>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="text-xs text-slate-400 hover:text-rose-600 transition-colors font-bold uppercase tracking-tighter"
                >
                  Reset
                </button>
              )}
            </div>

            {cart.map((item, index) => (
              <div
                key={`${item.itemType}-${item.id}-${index}`}
                className="flex gap-4 p-4 bg-slate-50/50 rounded-2xl border border-slate-100 relative group transition-colors hover:bg-white hover:shadow-sm"
              >
                <button
                  onClick={() => removeLine(index)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-white rounded-full border shadow-sm flex items-center justify-center text-slate-400 hover:text-rose-600 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{item.name}</p>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(index, -1)}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 shadow-sm"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-xs font-black w-6 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(index, 1)}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 shadow-sm"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-sm font-black text-slate-900">
                      ${(item.quantity * item.unitPrice).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {cart.length === 0 && (
              <div className="py-20 text-center space-y-4">
                <ShoppingCart className="h-12 w-12 text-slate-100 mx-auto" />
                <p className="text-slate-400 text-sm font-medium">Cart is empty.</p>
              </div>
            )}
          </div>

          {/* Checkout Logic */}
          <div className="p-8 border-t bg-slate-50/30 space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="collectNow"
                  checked={collectPaymentNow}
                  onChange={(e) => setCollectPaymentNow(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <label
                  htmlFor="collectNow"
                  className="text-sm font-bold text-slate-700 cursor-pointer"
                >
                  Record payment now
                </label>
              </div>

              {collectPaymentNow && (
                <div className="space-y-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-sm animate-in">
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="h-10 border-slate-100 bg-slate-50/50">
                      <SelectValue placeholder="Method" />
                    </SelectTrigger>
                    <SelectContent>
                      {MANUAL_PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <AppInput
                    placeholder="Partial amount (optional)"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="h-10 text-sm border-slate-100"
                  />
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100">
              <div className="flex justify-between items-center mb-6">
                <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">
                  Est. Total
                </span>
                <span className="text-3xl font-black text-slate-900">${total.toFixed(2)}</span>
              </div>
              <AppButton
                className="w-full h-14 rounded-2xl font-black text-lg shadow-xl shadow-primary-100"
                onClick={handleCheckout}
                disabled={isSubmitting || cart.length === 0}
              >
                {isSubmitting ? 'Finalizing...' : 'Complete Checkout'}
              </AppButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
