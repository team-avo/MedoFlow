'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getPublicProduct } from '@/lib/clinicApi'
import api from '@/lib/api'
import { AppButton, AppCard, AppCardContent, AppPageHeader, AppBadge } from '@/components/ui-system'
import {
  ArrowLeft,
  ShoppingCart,
  ShieldCheck,
  Truck,
  Star,
  CheckCircle2,
  Package,
  ShoppingBag,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

export default function ProductDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getPublicProduct(id),
    enabled: !!id,
  })

  const addToCart = async () => {
    try {
      await api.post('/carts/items', {
        itemType: 'PRODUCT',
        itemId: id,
        quantity: 1,
      })
      toast.success(`Added ${product.name} to cart`)
    } catch (error) {
      toast.error('Please login to add items to your cart')
      router.push('/?auth=login&returnUrl=/store')
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-12 px-4 space-y-8">
        <Skeleton className="h-8 w-32" />
        <div className="grid md:grid-cols-2 gap-12">
          <Skeleton className="aspect-square rounded-3xl" />
          <div className="space-y-6">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-6 w-1/4" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-14 w-full rounded-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="container mx-auto py-20 text-center">
        <h1 className="text-2xl font-bold">Product not found</h1>
        <AppButton variant="ghost" onClick={() => router.push('/store')}>
          Back to Store
        </AppButton>
      </div>
    )
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="container mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <AppButton
          variant="ghost"
          onClick={() => router.back()}
          className="mb-8 rounded-full text-slate-500"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Store
        </AppButton>

        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Product Image */}
          <div className="space-y-6">
            <div className="aspect-square bg-slate-50 rounded-[2.5rem] flex items-center justify-center border border-slate-100 overflow-hidden group">
              <ShoppingBag className="h-32 w-32 text-slate-200 transition-transform" />
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="aspect-square bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center"
                >
                  <ShoppingBag className="h-6 w-6 text-slate-200" />
                </div>
              ))}
            </div>
          </div>

          {/* Product Info */}
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <AppBadge
                  variant="accent"
                  className="rounded-full px-3 py-0.5 text-[10px] font-black uppercase tracking-widest"
                >
                  Provider Recommended
                </AppBadge>
                <div className="flex items-center gap-1 text-amber-400">
                  <Star className="h-3 w-3 fill-current" />
                  <Star className="h-3 w-3 fill-current" />
                  <Star className="h-3 w-3 fill-current" />
                  <Star className="h-3 w-3 fill-current" />
                  <Star className="h-3 w-3 fill-current" />
                </div>
              </div>
              <h1 className="text-4xl lg:text-5xl font-black text-slate-900 leading-tight">
                {product.name}
              </h1>
              <div className="text-3xl font-black text-primary-600">
                ${Number(product.price).toFixed(2)}
              </div>
            </div>

            <div className="space-y-6 py-8 border-y border-slate-100">
              <p className="text-lg text-slate-600 leading-relaxed">
                {product.description ||
                  'A professional-grade supplement curated by our clinical team to support your health goals. Formulated with high-potency ingredients for maximum bioavailability.'}
              </p>

              <ul className="grid sm:grid-cols-2 gap-4">
                {['Clinical Strength', 'Lab Tested Purity', 'Gluten Free', 'Non-GMO'].map(
                  (item) => (
                    <li
                      key={item}
                      className="flex items-center gap-3 text-sm font-bold text-slate-700"
                    >
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" /> {item}
                    </li>
                  )
                )}
              </ul>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-slate-900">Availability</span>
                {product.inventoryItem?.quantityInStock > 0 ? (
                  <span className="text-emerald-600 font-bold">
                    In Stock ({product.inventoryItem.quantityInStock} units)
                  </span>
                ) : (
                  <span className="text-rose-600 font-bold">Out of Stock</span>
                )}
              </div>
              <AppButton
                size="lg"
                className="w-full h-16 rounded-2xl text-lg font-bold shadow-lg shadow-primary-100"
                onClick={addToCart}
                disabled={product.inventoryItem?.quantityInStock === 0}
              >
                <ShoppingCart className="mr-2 h-5 w-5" /> Add to Shopping Cart
              </AppButton>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
                <Truck className="h-5 w-5 text-slate-400" />
                <div>
                  <p className="text-xs font-bold text-slate-900 uppercase tracking-tighter">
                    Fast Delivery
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium">2-3 Business Days</p>
                </div>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-slate-400" />
                <div>
                  <p className="text-xs font-bold text-slate-900 uppercase tracking-tighter">
                    Secure
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium">HIPAA Compliant</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Tabs / More info */}
        <div className="mt-24 space-y-12">
          <div className="border-b border-slate-100 pb-12">
            <h2 className="text-2xl font-black text-slate-900 mb-6">
              Why our providers recommend this
            </h2>
            <p className="text-slate-600 max-w-3xl leading-relaxed">
              At Medoflow, we believe that clinical outcomes are enhanced by high-quality
              nutritional support. This product has been specifically selected for our patients
              because it meets our rigorous standards for ingredient transparency and manufacturing
              excellence.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
