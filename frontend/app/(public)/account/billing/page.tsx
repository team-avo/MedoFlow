'use client'

import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ShoppingCart, Receipt, CreditCard } from 'lucide-react'
import { getMyInvoices } from '@/lib/patientApi'
import { getOnFile, cardLabel } from '@/lib/rxCartApi'
import { ShippingAddressForm } from '@/components/store/ShippingAddressForm'
import { formatAddress } from '@/components/store/OneClickPay'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppPageHeader,
  AppTable,
  AppButton,
  LoadingSkeleton,
  AppErrorState,
} from '@/components/ui-system'
import { StatusBadge } from '@/components/common/StatusBadge'

function formatCurrency(amount?: string | number | null) {
  return `$${Number(amount ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** F5.3: the card and shipping address on file from booking, for one-click orders. */
function OnFileCard() {
  const { data: onFile, isLoading } = useQuery({
    queryKey: ['carts', 'one-click'],
    queryFn: getOnFile,
    retry: false,
  })
  const [editing, setEditing] = React.useState(false)
  if (isLoading) return null

  return (
    <AppCard className="border border-slate-100 shadow-sm overflow-hidden bg-white">
      <AppCardHeader className="bg-slate-50/60 border-b border-slate-100 py-5 px-6">
        <AppCardTitle className="text-base font-semibold flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-indigo-600" />
          Card &amp; shipping on file
        </AppCardTitle>
      </AppCardHeader>
      <AppCardContent className="grid gap-6 p-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Card</p>
          <p className="mt-1 text-sm text-slate-800" data-testid="card-on-file">
            {onFile?.card
              ? cardLabel(onFile.card)
              : 'No card on file yet — the card you pay for a booking with is saved here.'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Held by Stripe. Used only when you choose “Pay with card on file”.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Shipping address
          </p>
          {onFile?.shippingAddress && !editing ? (
            <p className="mt-1 text-sm text-slate-800">
              {formatAddress(onFile.shippingAddress)}{' '}
              <button
                type="button"
                className="ml-1 text-xs font-medium text-indigo-700 underline"
                onClick={() => setEditing(true)}
              >
                Change
              </button>
            </p>
          ) : (
            <div className="mt-2">
              <ShippingAddressForm
                initial={onFile?.shippingAddress}
                onSaved={() => setEditing(false)}
              />
            </div>
          )}
        </div>
      </AppCardContent>
    </AppCard>
  )
}

export default function AccountBillingPage() {
  const {
    data: invoices = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['my-invoices'],
    queryFn: getMyInvoices,
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <AppPageHeader title="Billing & payments" description="Invoices and payment status" />
        <LoadingSkeleton variant="table" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <AppPageHeader title="Billing & payments" description="Invoices and payment status" />
        <AppErrorState
          title="Could not load your invoices"
          description="Try again in a moment."
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="Billing & payments"
        description="Invoices, receipts, and payment status"
        actions={
          <AppButton asChild className="rounded-full px-6 shadow-sm">
            <Link href="/store">
              <ShoppingCart className="mr-2 h-4 w-4" /> Store
            </Link>
          </AppButton>
        }
      />

      <OnFileCard />

      <AppCard className="border border-slate-100 shadow-sm overflow-hidden bg-white">
        <AppCardHeader className="bg-slate-50/60 border-b border-slate-100 py-5 px-6">
          <AppCardTitle className="text-base font-semibold flex items-center gap-2">
            <Receipt className="h-5 w-5 text-indigo-600" />
            Transaction history
          </AppCardTitle>
        </AppCardHeader>
        <AppCardContent className="p-0">
          <AppTable
            mobileCardMode
            columns={[
              {
                key: 'date',
                header: 'Date',
                mobilePrimary: true,
                render: (i) => (
                  <div>
                    <p className="font-semibold text-slate-900">{formatDate(i.createdAt)}</p>
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
                      Inv: {i.id.slice(-6).toUpperCase()}
                    </p>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                mobileLabel: 'Status',
                render: (i) => (
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={i.status} variant="invoice" />
                    <StatusBadge
                      status={i.financialStatus}
                      variant="invoice"
                      className="bg-transparent border-slate-100 text-[10px]"
                    />
                  </div>
                ),
              },
              {
                key: 'items',
                header: 'Items',
                render: (i) => (
                  <div className="max-w-xs truncate">
                    <p className="text-sm text-slate-600">
                      {i.items
                        ?.map((item: any) => item.description?.replace('Demo Cart Item: ', ''))
                        .join(', ') || 'Consultation'}
                    </p>
                  </div>
                ),
              },
              {
                key: 'total',
                header: 'Total',
                mobileLabel: 'Total',
                className: 'text-right',
                render: (i) => (
                  <p className="text-sm font-semibold text-slate-900">
                    {formatCurrency(i.totalAmount)}
                  </p>
                ),
              },
            ]}
            data={invoices}
            keyExtractor={(i) => i.id}
            emptyTitle="No invoices yet"
            emptyDescription="Your paid orders and visits will appear here."
          />
        </AppCardContent>
      </AppCard>
    </div>
  )
}
