'use client'

import React from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  getFilteredInvoices,
  getFinanceSummary,
  getReceivablesSummary,
  recordManualInvoicePayment,
  refundPayment,
  type Invoice,
  type InvoicePayment,
} from '@/lib/invoiceApi'
import { listProviders } from '@/lib/availabilityApi'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppButton,
  AppPageHeader,
  AppEmptyState,
  AppModal,
  KPIStatCard,
  AppTable,
  AppInput,
  DateRangeFilter,
  LoadingSkeleton,
} from '@/components/ui-system'
import type { DateRangeOption, DateRange } from '@/components/ui-system/DateRangeFilter'
import { StatusBadge } from '@/components/common/StatusBadge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAppToast } from '@/hooks/useAppToast'
import {
  DollarSign,
  CreditCard,
  Activity,
  Search,
  Filter,
  Calendar,
  History,
  ArrowRight,
  ShoppingCart,
  Plus,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageContainer } from '@/components/layout'

const DOC_STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Documents' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'FINALIZED', label: 'Finalized' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const FINANCE_STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Balances' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PARTIALLY_PAID', label: 'Partially paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' },
  { value: 'REFUNDED', label: 'Refunded' },
]

const MANUAL_PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CHECK', label: 'Check' },
  { value: 'CARD_PRESENT', label: 'Card (Manual)' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'OTHER', label: 'Other' },
]

function formatCurrency(amount?: string | number | null) {
  return `$${Number(amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function refundableRemaining(payment: InvoicePayment, allPayments: InvoicePayment[]) {
  const paymentAmount = Number(payment.amount)
  const refunded = allPayments
    .filter((entry) => entry.refundForPaymentId === payment.id)
    .reduce((sum, entry) => sum + Math.abs(Number(entry.amount)), 0)
  return Math.max(paymentAmount - refunded, 0)
}

export default function FrontDeskInvoicesPage() {
  const { user } = useAuth()
  const toast = useAppToast()
  const queryClient = useQueryClient()
  const clinicId = user?.clinicId ?? undefined
  const [docStatusFilter, setDocStatusFilter] = React.useState('ALL')
  const [financeStatusFilter, setFinanceStatusFilter] = React.useState('ALL')
  const [providerFilter, setProviderFilter] = React.useState('ALL')

  const [dateRangeOption, setDateRangeOption] = React.useState<DateRangeOption>('ALL_TIME')
  const [dateRangeValues, setDateRangeValues] = React.useState<DateRange>({})

  const [paymentInvoice, setPaymentInvoice] = React.useState<Invoice | null>(null)
  const [paymentMethod, setPaymentMethod] = React.useState('CASH')
  const [paymentAmount, setPaymentAmount] = React.useState('')
  const [paymentNotes, setPaymentNotes] = React.useState('')

  const [refundInvoice, setRefundInvoice] = React.useState<Invoice | null>(null)
  const [refundPaymentId, setRefundPaymentId] = React.useState('')
  const [refundAmount, setRefundAmount] = React.useState('')

  const isAllowed = user?.role === 'FRONT_DESK' || user?.role === 'SUPER_ADMIN'

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: [
      'front-desk-invoices',
      docStatusFilter,
      financeStatusFilter,
      providerFilter,
      dateRangeOption,
    ],
    queryFn: () =>
      getFilteredInvoices({
        status: docStatusFilter === 'ALL' ? undefined : docStatusFilter,
        financialStatus: financeStatusFilter === 'ALL' ? undefined : financeStatusFilter,
        providerId: providerFilter === 'ALL' ? undefined : providerFilter,
        dateFrom: dateRangeValues.startDate?.toISOString(),
        dateTo: dateRangeValues.endDate?.toISOString(),
      }),
    enabled: !!clinicId,
  })

  const { data: receivables, isLoading: receivablesLoading } = useQuery({
    queryKey: ['receivables-summary'],
    queryFn: () => getReceivablesSummary(),
    enabled: !!clinicId,
  })

  const { data: financeSummary, isLoading: financeLoading } = useQuery({
    queryKey: ['finance-summary', providerFilter, dateRangeOption],
    queryFn: () =>
      getFinanceSummary({
        providerId: providerFilter === 'ALL' ? undefined : providerFilter,
        dateFrom: dateRangeValues.startDate?.toISOString(),
        dateTo: dateRangeValues.endDate?.toISOString(),
      }),
    enabled: !!clinicId,
  })

  const { data: providers = [] } = useQuery({
    queryKey: ['providers'],
    queryFn: () => listProviders(),
    enabled: !!clinicId,
  })

  const collectMutation = useMutation({
    mutationFn: (payload: {
      invoiceId: string
      amount: number
      paymentMethod: string
      notes?: string
    }) =>
      recordManualInvoicePayment(payload.invoiceId, {
        amount: payload.amount,
        paymentMethod: payload.paymentMethod,
        notes: payload.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['front-desk-invoices'] })
      queryClient.invalidateQueries({ queryKey: ['receivables-summary'] })
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] })
      toast.success('Manual payment recorded')
      setPaymentInvoice(null)
      setPaymentAmount('')
      setPaymentNotes('')
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.message || 'Failed to record payment'),
  })

  const refundMutation = useMutation({
    mutationFn: (payload: { paymentId: string; amount?: number }) =>
      refundPayment(payload.paymentId, payload.amount ? { amount: payload.amount } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['front-desk-invoices'] })
      queryClient.invalidateQueries({ queryKey: ['receivables-summary'] })
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] })
      toast.success('Refund recorded')
      setRefundInvoice(null)
      setRefundPaymentId('')
      setRefundAmount('')
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Failed to refund'),
  })

  const eligibleRefundPayments = React.useMemo(() => {
    if (!refundInvoice?.payments) return []
    return refundInvoice.payments.filter((payment) => {
      const amount = Number(payment.amount)
      return amount > 0 && refundableRemaining(payment, refundInvoice.payments ?? []) > 0
    })
  }, [refundInvoice])

  React.useEffect(() => {
    if (!refundInvoice) return
    if (eligibleRefundPayments.length > 0 && !refundPaymentId) {
      setRefundPaymentId(eligibleRefundPayments[0]!.id)
    }
  }, [eligibleRefundPayments, refundInvoice, refundPaymentId])

  if (!isAllowed || !clinicId) return null

  const submitManualPayment = () => {
    if (!paymentInvoice) return
    const amount =
      paymentAmount.trim().length > 0
        ? Number(paymentAmount)
        : Number(paymentInvoice.outstandingAmount)
    collectMutation.mutate({
      invoiceId: paymentInvoice.id,
      amount,
      paymentMethod,
      notes: paymentNotes.trim() || undefined,
    })
  }

  const submitRefund = () => {
    if (!refundPaymentId) {
      toast.error('Select a payment to refund')
      return
    }
    refundMutation.mutate({
      paymentId: refundPaymentId,
      amount: refundAmount.trim().length > 0 ? Number(refundAmount) : undefined,
    })
  }

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Billing Operations"
        description="Monitor clinic revenue, collect outstanding balances, and manage refunds."
        actions={
          <div className="flex flex-wrap gap-4 items-center">
            <DateRangeFilter
              value={dateRangeOption}
              onChange={(opt, range) => {
                setDateRangeOption(opt)
                setDateRangeValues(range)
              }}
            />
            <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
            <AppButton asChild className="rounded-full px-6 shadow-md">
              <Link href="/dashboard/front-desk/pos">
                <ShoppingCart className="mr-2 h-4 w-4" /> New Checkout
              </Link>
            </AppButton>
          </div>
        }
      />

      {receivablesLoading || financeLoading ? (
        <LoadingSkeleton variant="stat" count={4} />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <KPIStatCard
            label="Outstanding AR"
            value={formatCurrency(receivables?.totalOutstandingAmount)}
            icon={CreditCard}
            iconClassName="text-amber-600 bg-amber-50"
            description={`${receivables?.outstandingInvoiceCount ?? 0} unpaid invoices`}
          />
          <KPIStatCard
            label="Total Collected"
            value={formatCurrency(financeSummary?.totalCollected)}
            icon={DollarSign}
            iconClassName="text-emerald-600 bg-emerald-50"
            description="In selected period"
          />
          <KPIStatCard
            label="Total Refunds"
            value={formatCurrency(financeSummary?.totalRefunded)}
            icon={History}
            iconClassName="text-rose-600 bg-rose-50"
          />
          <KPIStatCard
            label="Net Billed"
            value={formatCurrency(financeSummary?.totalInvoiced)}
            icon={Activity}
            iconClassName="text-blue-600 bg-blue-50"
          />
        </div>
      )}

      <AppCard className="border-none shadow-sm overflow-hidden bg-white">
        <AppCardHeader className="bg-slate-50/50 border-b-0 py-6 px-8 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <AppCardTitle className="text-lg font-bold">Clinical Ledger</AppCardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-44 h-10 rounded-xl bg-white border-slate-200">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Providers</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={financeStatusFilter} onValueChange={setFinanceStatusFilter}>
              <SelectTrigger className="w-44 h-10 rounded-xl bg-white border-slate-200">
                <SelectValue placeholder="Balance" />
              </SelectTrigger>
              <SelectContent>
                {FINANCE_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </AppCardHeader>
        <AppCardContent className="p-0">
          {isLoading ? (
            <LoadingSkeleton variant="table" className="rounded-none border-0" />
          ) : (
            <AppTable
              mobileCardMode
              columns={[
                {
                  key: 'patient',
                  header: 'Patient',
                  mobilePrimary: true,
                  render: (i) => (
                    <div>
                      <p className="font-bold text-slate-900">{i.patient?.name ?? '—'}</p>
                      <p className="text-[10px] text-slate-400 font-black uppercase tracking-tighter mt-0.5">
                        Inv: {i.id.slice(-6).toUpperCase()}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'finance',
                  header: 'Status',
                  mobileLabel: 'Status',
                  render: (i) => (
                    <div className="flex flex-col items-start gap-1 md:items-start">
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
                  key: 'amounts',
                  header: 'Amounts',
                  mobileLabel: 'Total',
                  className: 'text-right',
                  render: (i) => (
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">
                        {formatCurrency(i.totalAmount)}
                      </p>
                      <p className="text-[10px] text-emerald-600 font-bold">
                        Paid: {formatCurrency(i.totalPaid)}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'outstanding',
                  header: 'Balance',
                  mobileLabel: 'Balance',
                  className: 'text-right',
                  render: (i) => (
                    <span
                      className={cn(
                        'font-black',
                        Number(i.outstandingAmount) > 0 ? 'text-amber-600' : 'text-slate-400'
                      )}
                    >
                      {formatCurrency(i.outstandingAmount)}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  mobileLabel: 'Actions',
                  className: 'text-right',
                  render: (i) => (
                    <div className="flex flex-wrap justify-end gap-2 md:pr-4">
                      {Number(i.outstandingAmount) > 0 &&
                        i.status !== 'DRAFT' &&
                        i.status !== 'CANCELLED' && (
                          <AppButton
                            size="sm"
                            className="rounded-full shadow-md"
                            onClick={() => setPaymentInvoice(i)}
                          >
                            Collect
                          </AppButton>
                        )}
                      <AppButton variant="ghost" size="sm" className="rounded-full" asChild>
                        <Link href={`/dashboard/front-desk/invoices/${i.id}`}>Review</Link>
                      </AppButton>
                    </div>
                  ),
                },
              ]}
              data={invoices}
              keyExtractor={(i) => i.id}
            />
          )}
        </AppCardContent>
      </AppCard>

      {/* Modals for Payment and Refund */}
      <AppModal
        open={Boolean(paymentInvoice)}
        onOpenChange={(open) => !open && setPaymentInvoice(null)}
        title="Collect Payment"
        description={
          paymentInvoice
            ? `Recording manual payment for ${paymentInvoice.patient?.name}. Balance: ${formatCurrency(paymentInvoice.outstandingAmount)}`
            : ''
        }
        primaryAction={{
          label: collectMutation.isPending ? 'Processing...' : 'Confirm Payment',
          onClick: submitManualPayment,
          disabled: collectMutation.isPending,
        }}
        content={
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase text-slate-400">Payment Method</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-12 rounded-2xl">
                  <SelectValue placeholder="Select Method" />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black uppercase text-slate-400">Amount ($)</label>
              <AppInput
                value={paymentAmount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPaymentAmount(e.target.value)
                }
                placeholder="Leave blank for full balance"
                className="h-12 rounded-2xl"
              />
            </div>
          </div>
        }
      />
    </PageContainer>
  )
}
