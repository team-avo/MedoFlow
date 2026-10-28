'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Download,
  CreditCard,
  Calendar,
  User,
  Receipt,
  Plus,
  Trash2,
  FileText,
} from 'lucide-react'
import {
  getInvoiceById,
  finalizeInvoice,
  recordManualInvoicePayment,
  type Invoice,
  type InvoiceItem,
} from '@/lib/invoiceApi'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppButton,
  AppPageHeader,
  AppBadge,
  AppTable,
  AppEmptyState,
  StickySummaryPanel,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppToast } from '@/hooks/useAppToast'

function formatCurrency(amount?: string | number | null) {
  return `$${Number(amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const toast = useAppToast()
  const queryClient = useQueryClient()

  const {
    data: invoice,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => getInvoiceById(id),
    enabled: !!id,
  })

  const finalizeMutation = useMutation({
    mutationFn: () => finalizeInvoice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
      toast.success('Invoice finalized')
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Failed to finalize'),
  })

  if (isLoading) {
    return (
      <PageContainer className="space-y-8">
        <Skeleton className="h-12 w-48" />
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </PageContainer>
    )
  }

  if (error || !invoice) {
    return (
      <PageContainer>
        <AppEmptyState
          title="Invoice Not Found"
          description="The invoice you are looking for does not exist or has been removed."
          actionLabel="Go Back"
          onAction={() => router.back()}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer className="space-y-8">
      <div className="flex items-center gap-4">
        <AppButton
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          className="rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </AppButton>
        <AppPageHeader
          title={`Invoice ${invoice.id.slice(-6).toUpperCase()}`}
          description={`Issued on ${formatDate(invoice.createdAt)}`}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 space-y-8">
          {/* Patient & Provider Info */}
          <div className="grid sm:grid-cols-2 gap-6">
            <AppCard className="border-none shadow-sm">
              <AppCardHeader className="bg-slate-50/50 border-b-0 py-4 px-6">
                <AppCardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <User className="h-3.5 w-3.5" /> Patient Details
                </AppCardTitle>
              </AppCardHeader>
              <AppCardContent className="p-6">
                <p className="font-bold text-slate-900 text-lg">{invoice.patient?.name}</p>
                <p className="text-sm text-slate-500 mt-1">{invoice.patient?.email}</p>
              </AppCardContent>
            </AppCard>

            <AppCard className="border-none shadow-sm">
              <AppCardHeader className="bg-slate-50/50 border-b-0 py-4 px-6">
                <AppCardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Receipt className="h-3.5 w-3.5" /> Billing Entity
                </AppCardTitle>
              </AppCardHeader>
              <AppCardContent className="p-6">
                <p className="font-bold text-slate-900 text-lg">
                  {invoice.provider
                    ? `Dr. ${invoice.provider.firstName} ${invoice.provider.lastName}`
                    : 'Clinic Direct'}
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Provider ID: {invoice.providerId?.slice(-6).toUpperCase() || 'N/A'}
                </p>
              </AppCardContent>
            </AppCard>
          </div>

          {/* Line Items */}
          <AppCard className="border-none shadow-sm overflow-hidden">
            <AppCardHeader className="bg-slate-50/50 border-b-0 py-6 px-8 flex flex-row items-center justify-between">
              <AppCardTitle className="font-bold">Invoice Items</AppCardTitle>
              <AppBadge variant="outline" className="rounded-full px-3 py-1 font-bold">
                {invoice.items.length} Items
              </AppBadge>
            </AppCardHeader>
            <AppCardContent className="p-0">
              <AppTable
                columns={[
                  {
                    key: 'description',
                    header: 'Description',
                    wrap: true,
                    render: (item: InvoiceItem) => (
                      <div className="py-1">
                        <p className="font-bold text-slate-900">{item.description}</p>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-tighter mt-0.5">
                          {item.serviceId ? 'Service' : item.productId ? 'Product' : 'Package'}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: 'quantity',
                    header: 'Qty',
                    className: 'text-center',
                    render: (item: InvoiceItem) => (
                      <span className="font-medium text-slate-600">{item.quantity}</span>
                    ),
                  },
                  {
                    key: 'unitPrice',
                    header: 'Unit Price',
                    className: 'text-right',
                    render: (item: InvoiceItem) => (
                      <span className="font-medium text-slate-600">
                        {formatCurrency(item.unitPrice)}
                      </span>
                    ),
                  },
                  {
                    key: 'total',
                    header: 'Amount',
                    className: 'text-right',
                    render: (item: InvoiceItem) => (
                      <span className="font-black text-slate-900">
                        {formatCurrency(item.totalPrice)}
                      </span>
                    ),
                  },
                ]}
                data={invoice.items}
                keyExtractor={(item) => item.id}
              />
            </AppCardContent>
          </AppCard>

          {/* Payment History */}
          {invoice.payments && invoice.payments.length > 0 && (
            <AppCard className="border-none shadow-sm overflow-hidden">
              <AppCardHeader className="bg-slate-50/50 border-b-0 py-6 px-8">
                <AppCardTitle className="font-bold">Transaction History</AppCardTitle>
              </AppCardHeader>
              <AppCardContent className="p-0">
                <AppTable
                  columns={[
                    {
                      key: 'date',
                      header: 'Date',
                      render: (p) => (
                        <span className="text-sm font-medium text-slate-600">
                          {formatDate(p.recordedAt)}
                        </span>
                      ),
                    },
                    {
                      key: 'method',
                      header: 'Method',
                      render: (p) => (
                        <AppBadge
                          variant="secondary"
                          className="font-bold uppercase tracking-tighter text-[10px]"
                        >
                          {p.paymentMethod?.replace('_', ' ')}
                        </AppBadge>
                      ),
                    },
                    {
                      key: 'amount',
                      header: 'Amount',
                      className: 'text-right',
                      render: (p) => (
                        <span
                          className={cn(
                            'font-black',
                            Number(p.amount) < 0 ? 'text-rose-600' : 'text-emerald-600'
                          )}
                        >
                          {formatCurrency(p.amount)}
                        </span>
                      ),
                    },
                  ]}
                  data={invoice.payments}
                  keyExtractor={(p) => p.id}
                />
              </AppCardContent>
            </AppCard>
          )}
        </div>

        {/* Sidebar Actions */}
        <div className="lg:col-span-1 space-y-8 sticky top-8">
          <StickySummaryPanel
            title="Financial Summary"
            items={[
              {
                label: 'Invoice Status',
                value: <StatusBadge status={invoice.status} variant="invoice" />,
              },
              {
                label: 'Payment Status',
                value: (
                  <StatusBadge
                    status={invoice.financialStatus}
                    variant="invoice"
                    className="bg-transparent border-slate-100"
                  />
                ),
              },
              { label: 'Subtotal', value: formatCurrency(invoice.subtotal) },
              { label: 'Tax', value: formatCurrency(invoice.taxAmount) },
              { label: 'Total Billed', value: formatCurrency(invoice.totalAmount), isTotal: true },
              { label: 'Total Paid', value: formatCurrency(invoice.totalPaid) },
              {
                label: 'Outstanding',
                value: formatCurrency(invoice.outstandingAmount),
                isTotal: true,
                className:
                  Number(invoice.outstandingAmount) > 0 ? 'text-amber-600' : 'text-slate-400',
              },
            ]}
            actions={
              <div className="space-y-3">
                {invoice.status === 'DRAFT' && (
                  <AppButton
                    className="w-full rounded-full h-12 font-bold shadow-lg"
                    onClick={() => finalizeMutation.mutate()}
                    disabled={finalizeMutation.isPending}
                  >
                    Finalize Invoice
                  </AppButton>
                )}
                <AppButton
                  variant="outline"
                  className="w-full rounded-full h-12 bg-white font-bold"
                >
                  <Download className="mr-2 h-4 w-4" /> Download PDF
                </AppButton>
              </div>
            }
          />

          <AppCard className="bg-slate-900 text-white border-none rounded-[2rem] overflow-hidden">
            <AppCardContent className="p-8 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary-600 rounded-xl shadow-lg">
                  <CreditCard className="h-5 w-5 text-white" />
                </div>
                <h4 className="font-bold text-lg">Secure Billing</h4>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                This invoice is legally binding. All clinical services and products listed are
                subject to the clinic's refund and cancellation policy.
              </p>
            </AppCardContent>
          </AppCard>
        </div>
      </div>
    </PageContainer>
  )
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ')
}
