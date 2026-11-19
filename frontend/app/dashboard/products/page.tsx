'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppButton,
  AppPageHeader,
  AppEmptyState,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { getProducts, type Product } from '@/lib/productApi'
import { useRouter } from 'next/navigation'
import { Plus, Package, Download } from 'lucide-react'
import { AddProductModal } from '@/components/products/AddProductModal'
import { StockControl } from '@/components/products/StockControl'
import { useAuth } from '@/contexts/AuthContext'
import { PRODUCT_CLASS_LABELS } from '@/lib/rxCartApi'
import { ClassifyControl } from '@/components/products/ClassifyControl'
import { PROVIDER_LABELS, type StoreProvider } from '@/lib/catalogImportApi'
import { Skeleton } from '@/components/ui/skeleton'

export default function ProductsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { user } = useAuth()
  const router = useRouter()
  const canAdjust = user?.role === 'SUPER_ADMIN'
  const canImport = user?.role === 'SUPER_ADMIN' || user?.role === 'STAFF'

  const {
    data: products = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['products'],
    queryFn: getProducts,
  })

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Products Catalog"
        description="Manage clinical supplements, wellness products, and retail inventory."
        actions={
          <div className="flex flex-wrap gap-2">
            {canImport && (
              <AppButton
                variant="outline"
                className="rounded-full px-6"
                onClick={() => router.push('/dashboard/products/import')}
              >
                <Download className="mr-2 h-4 w-4" /> Import products
              </AppButton>
            )}
            <AppButton onClick={() => setIsModalOpen(true)} className="rounded-full shadow-md px-6">
              <Plus className="mr-2 h-4 w-4" /> Add Product
            </AppButton>
          </div>
        }
      />

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <p className="text-sm font-medium text-destructive">
            Failed to load product catalog. Please try again.
          </p>
        </div>
      ) : products.length === 0 ? (
        <AppEmptyState
          title="No products yet"
          description="Your clinical store is currently empty. Add your first product, or import your catalog from Shopify, Square, WooCommerce, Wix or a spreadsheet."
          actionLabel="Add First Product"
          onAction={() => setIsModalOpen(true)}
          className="py-24"
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product: Product) => (
            <AppCard
              key={product.id}
              className="border-none shadow-sm hover:shadow-md transition-colors overflow-hidden"
            >
              <AppCardHeader className="bg-slate-50/50 border-b-0 py-6 px-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <AppCardTitle className="text-lg font-bold text-slate-900 leading-tight">
                      {product.name}
                    </AppCardTitle>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {product.fulfillmentClass && product.fulfillmentClass !== 'UNCLASSIFIED' && (
                        <span
                          className={cn(
                            'inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                            product.fulfillmentClass.startsWith('RX_')
                              ? 'bg-violet-100 text-violet-800'
                              : 'bg-slate-100 text-slate-700'
                          )}
                        >
                          {PRODUCT_CLASS_LABELS[product.fulfillmentClass]}
                        </span>
                      )}
                      {product.externalSource && (
                        <span className="inline-block rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                          {`From ${PROVIDER_LABELS[product.externalSource as StoreProvider] ?? 'a file'}`}
                        </span>
                      )}
                    </div>
                    {product.fulfillmentClass === 'UNCLASSIFIED' && (
                      <ClassifyControl
                        productId={product.id}
                        productName={product.name}
                        canEdit={canAdjust}
                      />
                    )}
                  </div>
                  {product.imageUrl ? (
                    // Clinic-hosted photo (SiteAsset); plain img keeps any host working.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-xl border border-slate-100 bg-white object-cover"
                    />
                  ) : (
                    <div className="p-2 bg-white rounded-xl shadow-sm border border-slate-100">
                      <Package className="h-4 w-4 text-primary-600" />
                    </div>
                  )}
                </div>
              </AppCardHeader>
              <AppCardContent className="p-6">
                <p className="text-sm text-slate-500 line-clamp-3 mb-6 min-h-[3rem]">
                  {product.description || 'No clinical description available.'}
                </p>
                <div className="flex justify-between items-end border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">
                      Price
                    </p>
                    <span className="font-black text-2xl text-slate-900">
                      ${Number(product.price).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">
                      Availability
                    </p>
                    <StockControl
                      productId={product.id}
                      productName={product.name}
                      quantity={product.inventoryItem?.quantityInStock ?? 0}
                      canAdjust={canAdjust}
                    />
                  </div>
                </div>
              </AppCardContent>
            </AppCard>
          ))}
        </div>
      )}

      <AddProductModal open={isModalOpen} onOpenChange={setIsModalOpen} />
    </PageContainer>
  )
}

// Helper for conditional classes
function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ')
}
