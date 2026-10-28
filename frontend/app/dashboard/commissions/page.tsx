'use client'

import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useAppToast } from '@/hooks/useAppToast'
import {
  createCommissionRule,
  getCommissionRecords,
  getCommissionRules,
  markCommissionRecordsPaid,
  updateCommissionRule,
  type CommissionRuleRecord,
} from '@/lib/commissionApi'
import { listProviders } from '@/lib/availabilityApi'
import { getDashboardServices } from '@/lib/serviceApi'
import { getPackages } from '@/lib/packageApi'
import api from '@/lib/api'
import { StatusBadge } from '@/components/common/StatusBadge'
import {
  AppBadge,
  AppButton,
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppEmptyState,
  AppInput,
  AppPageHeader,
  AppTable,
} from '@/components/ui-system'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageContainer } from '@/components/layout'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

const ITEM_TYPE_OPTIONS = [
  { value: 'ALL', label: 'All invoice items' },
  { value: 'SERVICE', label: 'Specific service' },
  { value: 'PRODUCT', label: 'Specific product' },
  { value: 'PACKAGE', label: 'Specific package' },
] as const

const COMMISSION_TYPE_OPTIONS = [
  { value: 'PERCENTAGE', label: 'Percentage' },
  { value: 'FLAT_RATE', label: 'Flat rate' },
] as const

const RECORD_STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const

function formatMoney(amount?: string | number | null) {
  return `$${Number(amount ?? 0).toFixed(2)}`
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function ruleTargetLabel(rule: CommissionRuleRecord) {
  if (rule.itemType === 'SERVICE') return rule.service?.name ?? 'Service'
  if (rule.itemType === 'PRODUCT') return rule.product?.name ?? 'Product'
  if (rule.itemType === 'PACKAGE') return rule.package?.name ?? 'Package'
  return 'All invoice items'
}

export default function CommissionsPage() {
  const { user } = useAuth()
  const toast = useAppToast()
  const queryClient = useQueryClient()
  const isProvider = user?.role === 'PROVIDER'
  const isAdmin = user?.role === 'SUPER_ADMIN'

  const [activeTab, setActiveTab] = React.useState<'rules' | 'records'>(
    isProvider ? 'records' : 'rules'
  )
  const [editingRuleId, setEditingRuleId] = React.useState<string | null>(null)
  const [ruleForm, setRuleForm] = React.useState({
    providerId: 'ALL',
    itemType: 'ALL',
    targetId: '',
    commissionType: 'PERCENTAGE',
    commissionValue: '',
    isActive: true,
  })
  const [recordFilters, setRecordFilters] = React.useState({
    providerId: 'ALL',
    status: 'ALL',
    dateFrom: '',
    dateTo: '',
  })

  const { data: rules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ['commission-rules'],
    queryFn: () => getCommissionRules(true),
    enabled: !!user?.clinicId && !isProvider,
  })

  const { data: providers = [] } = useQuery({
    queryKey: ['providers'],
    queryFn: () => listProviders(),
    enabled: !!user?.clinicId && isAdmin,
  })

  const { data: services = [] } = useQuery({
    queryKey: ['dashboard-services'],
    queryFn: () => getDashboardServices(),
    enabled: !!user?.clinicId && isAdmin,
  })

  const { data: products = [] } = useQuery({
    queryKey: ['commission-products'],
    queryFn: async () => {
      const res = await api.get('/products')
      return res.data.data.products ?? []
    },
    enabled: !!user?.clinicId && isAdmin,
  })

  const { data: packages = [] } = useQuery({
    queryKey: ['commission-packages'],
    queryFn: () => getPackages(true),
    enabled: !!user?.clinicId && isAdmin,
  })

  const { data: recordResponse, isLoading: recordsLoading } = useQuery({
    queryKey: ['commission-records', recordFilters],
    queryFn: () =>
      getCommissionRecords({
        providerId: recordFilters.providerId !== 'ALL' ? recordFilters.providerId : undefined,
        status: recordFilters.status !== 'ALL' ? recordFilters.status : undefined,
        dateFrom: recordFilters.dateFrom || undefined,
        dateTo: recordFilters.dateTo || undefined,
      }),
    enabled: !!user?.clinicId,
  })

  const saveRuleMutation = useMutation({
    mutationFn: async () => {
      const payload: {
        providerId?: string
        itemType: 'ALL' | 'SERVICE' | 'PRODUCT' | 'PACKAGE'
        serviceId?: string
        productId?: string
        packageId?: string
        commissionType: 'PERCENTAGE' | 'FLAT_RATE'
        commissionValue: number
        isActive: boolean
      } = {
        itemType: ruleForm.itemType as any,
        commissionType: ruleForm.commissionType as any,
        commissionValue: Number(ruleForm.commissionValue),
        isActive: ruleForm.isActive,
      }

      if (ruleForm.providerId !== 'ALL') payload.providerId = ruleForm.providerId
      if (ruleForm.itemType === 'SERVICE' && ruleForm.targetId)
        payload.serviceId = ruleForm.targetId
      if (ruleForm.itemType === 'PRODUCT' && ruleForm.targetId)
        payload.productId = ruleForm.targetId
      if (ruleForm.itemType === 'PACKAGE' && ruleForm.targetId)
        payload.packageId = ruleForm.targetId

      if (editingRuleId) {
        return updateCommissionRule(editingRuleId, payload)
      }
      return createCommissionRule(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] })
      toast.success(editingRuleId ? 'Commission rule updated' : 'Commission rule created')
      setEditingRuleId(null)
      setRuleForm({
        providerId: 'ALL',
        itemType: 'ALL',
        targetId: '',
        commissionType: 'PERCENTAGE',
        commissionValue: '',
        isActive: true,
      })
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.message || 'Failed to save commission rule'),
  })

  const markPaidMutation = useMutation({
    mutationFn: (recordIds: string[]) => markCommissionRecordsPaid(recordIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-records'] })
      toast.success('Commission payout status updated')
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.message || 'Failed to update commission status'),
  })

  const records = recordResponse?.records ?? []
  const summary = recordResponse?.summary

  const pendingRecordIds = records
    .filter((record) => record.status === 'PENDING')
    .map((record) => record.id)

  const currentTargetOptions =
    ruleForm.itemType === 'SERVICE'
      ? services.map((service) => ({ id: service.id, name: service.name }))
      : ruleForm.itemType === 'PRODUCT'
        ? products.map((product: any) => ({ id: product.id, name: product.name }))
        : ruleForm.itemType === 'PACKAGE'
          ? packages.map((pkg) => ({ id: pkg.id, name: pkg.name }))
          : ([] as Array<{ id: string; name: string }>)

  const loadRuleIntoForm = (rule: CommissionRuleRecord) => {
    setEditingRuleId(rule.id)
    setRuleForm({
      providerId: rule.providerId ?? 'ALL',
      itemType: rule.itemType,
      targetId: rule.serviceId ?? rule.productId ?? rule.packageId ?? '',
      commissionType: rule.commissionType,
      commissionValue: String(Number(rule.commissionValue)),
      isActive: rule.isActive,
    })
    setActiveTab('rules')
  }

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Commissions"
        description={
          isProvider
            ? 'View your commission ledger and payout status.'
            : 'Configure commission rules and track provider earnings. Marking records as paid updates payout tracking only — it does not initiate a bank transfer or payroll disbursement.'
        }
      />

      <div className="flex w-fit gap-2 rounded-lg border border-slate-200 bg-white p-1">
        {!isProvider && (
          <button
            onClick={() => setActiveTab('rules')}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              activeTab === 'rules' ? 'bg-slate-900 text-white' : 'text-slate-600'
            }`}
          >
            Rules
          </button>
        )}
        <button
          onClick={() => setActiveTab('records')}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            activeTab === 'records' ? 'bg-slate-900 text-white' : 'text-slate-600'
          }`}
        >
          Ledger
        </button>
      </div>

      {activeTab === 'rules' && !isProvider && (
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <AppCard>
            <AppCardHeader>
              <AppCardTitle>
                {editingRuleId ? 'Edit Commission Rule' : 'Add Commission Rule'}
              </AppCardTitle>
            </AppCardHeader>
            <AppCardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Provider</label>
                <Select
                  value={ruleForm.providerId}
                  onValueChange={(value) =>
                    setRuleForm((current) => ({ ...current, providerId: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All providers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All providers</SelectItem>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.firstName} {provider.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Rule Target</label>
                <Select
                  value={ruleForm.itemType}
                  onValueChange={(value) =>
                    setRuleForm((current) => ({
                      ...current,
                      itemType: value,
                      targetId: '',
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {ruleForm.itemType !== 'ALL' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Specific Item</label>
                  <Select
                    value={ruleForm.targetId}
                    onValueChange={(value) =>
                      setRuleForm((current) => ({ ...current, targetId: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      {currentTargetOptions.map((option: { id: string; name: string }) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Commission Type</label>
                <Select
                  value={ruleForm.commissionType}
                  onValueChange={(value) =>
                    setRuleForm((current) => ({ ...current, commissionType: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMISSION_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Commission Value</label>
                <AppInput
                  value={ruleForm.commissionValue}
                  onChange={(event) =>
                    setRuleForm((current) => ({ ...current, commissionValue: event.target.value }))
                  }
                  placeholder={ruleForm.commissionType === 'PERCENTAGE' ? 'e.g. 20' : 'e.g. 25.00'}
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={ruleForm.isActive}
                  onChange={(event) =>
                    setRuleForm((current) => ({ ...current, isActive: event.target.checked }))
                  }
                />
                Rule is active
              </label>

              <div className="flex gap-2">
                <AppButton
                  className="flex-1"
                  onClick={() => saveRuleMutation.mutate()}
                  disabled={saveRuleMutation.isPending}
                >
                  {saveRuleMutation.isPending
                    ? 'Saving...'
                    : editingRuleId
                      ? 'Update Rule'
                      : 'Create Rule'}
                </AppButton>
                {editingRuleId && (
                  <AppButton
                    variant="outline"
                    onClick={() => {
                      setEditingRuleId(null)
                      setRuleForm({
                        providerId: 'ALL',
                        itemType: 'ALL',
                        targetId: '',
                        commissionType: 'PERCENTAGE',
                        commissionValue: '',
                        isActive: true,
                      })
                    }}
                  >
                    Cancel
                  </AppButton>
                )}
              </div>
            </AppCardContent>
          </AppCard>

          <AppCard>
            <AppCardHeader>
              <AppCardTitle>Rule Inventory</AppCardTitle>
            </AppCardHeader>
            <AppCardContent>
              {rulesLoading ? (
                <LoadingSkeleton variant="row" count={4} />
              ) : rules.length === 0 ? (
                <AppEmptyState
                  title="No commission rules"
                  description="Create an active rule to start generating commission ledger records on paid invoices."
                />
              ) : (
                <div className="space-y-3">
                  {rules.map((rule) => (
                    <div key={rule.id} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-slate-900">
                              {rule.provider
                                ? `${rule.provider.firstName} ${rule.provider.lastName}`
                                : 'All providers'}
                            </div>
                            <StatusBadge
                              status={rule.isActive ? 'PAID' : 'DRAFT'}
                              variant="invoice"
                            />
                          </div>
                          <div className="text-sm text-slate-600">
                            {
                              ITEM_TYPE_OPTIONS.find((option) => option.value === rule.itemType)
                                ?.label
                            }
                            {' · '}
                            {ruleTargetLabel(rule)}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <AppBadge variant="secondary">
                              {rule.commissionType === 'PERCENTAGE' ? 'Percentage' : 'Flat rate'}
                            </AppBadge>
                            <AppBadge variant="outline">
                              {rule.commissionType === 'PERCENTAGE'
                                ? `${Number(rule.commissionValue).toFixed(2)}%`
                                : formatMoney(rule.commissionValue)}
                            </AppBadge>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <AppButton variant="outline" onClick={() => loadRuleIntoForm(rule)}>
                            Edit
                          </AppButton>
                          <AppButton
                            variant="ghost"
                            onClick={() =>
                              updateCommissionRule(rule.id, { isActive: !rule.isActive })
                                .then(() => {
                                  queryClient.invalidateQueries({ queryKey: ['commission-rules'] })
                                  toast.success(
                                    rule.isActive ? 'Rule deactivated' : 'Rule activated'
                                  )
                                })
                                .catch((error: any) => {
                                  toast.error(
                                    error?.response?.data?.message || 'Failed to update rule'
                                  )
                                })
                            }
                          >
                            {rule.isActive ? 'Deactivate' : 'Activate'}
                          </AppButton>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </AppCardContent>
          </AppCard>
        </div>
      )}

      {activeTab === 'records' && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <AppCard>
              <AppCardHeader>
                <AppCardTitle>Total Commission</AppCardTitle>
              </AppCardHeader>
              <AppCardContent className="text-3xl font-semibold text-slate-900">
                {formatMoney(summary?.totalAmount)}
              </AppCardContent>
            </AppCard>
            <AppCard>
              <AppCardHeader>
                <AppCardTitle>Pending Payout Status</AppCardTitle>
              </AppCardHeader>
              <AppCardContent>
                <div className="text-3xl font-semibold text-amber-600">
                  {formatMoney(summary?.pendingAmount)}
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  {summary?.pendingCount ?? 0} records still marked pending
                </div>
              </AppCardContent>
            </AppCard>
            <AppCard>
              <AppCardHeader>
                <AppCardTitle>Paid Payout Status</AppCardTitle>
              </AppCardHeader>
              <AppCardContent>
                <div className="text-3xl font-semibold text-emerald-600">
                  {formatMoney(summary?.paidAmount)}
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  {summary?.paidCount ?? 0} records marked paid in-app
                </div>
              </AppCardContent>
            </AppCard>
          </div>

          <AppCard>
            <AppCardHeader>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <AppCardTitle>Commission Ledger</AppCardTitle>
                <div className="flex flex-col gap-3 lg:flex-row">
                  {!isProvider && (
                    <Select
                      value={recordFilters.providerId}
                      onValueChange={(value) =>
                        setRecordFilters((current) => ({ ...current, providerId: value }))
                      }
                    >
                      <SelectTrigger className="w-full sm:w-[200px]">
                        <SelectValue placeholder="Provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All providers</SelectItem>
                        {providers.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.firstName} {provider.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select
                    value={recordFilters.status}
                    onValueChange={(value) =>
                      setRecordFilters((current) => ({ ...current, status: value }))
                    }
                  >
                    <SelectTrigger className="w-full sm:w-[180px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {RECORD_STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <AppInput
                    type="date"
                    value={recordFilters.dateFrom}
                    onChange={(event) =>
                      setRecordFilters((current) => ({ ...current, dateFrom: event.target.value }))
                    }
                  />
                  <AppInput
                    type="date"
                    value={recordFilters.dateTo}
                    onChange={(event) =>
                      setRecordFilters((current) => ({ ...current, dateTo: event.target.value }))
                    }
                  />
                </div>
              </div>
            </AppCardHeader>
            <AppCardContent className="space-y-4">
              {!isProvider && pendingRecordIds.length > 0 && (
                <div className="flex justify-end">
                  <AppButton
                    variant="outline"
                    onClick={() => markPaidMutation.mutate(pendingRecordIds)}
                    disabled={markPaidMutation.isPending}
                  >
                    {markPaidMutation.isPending
                      ? 'Updating...'
                      : 'Mark Visible Pending Records as Paid'}
                  </AppButton>
                </div>
              )}

              <div className="text-sm text-slate-600">
                “Mark paid” only records local payout status. It does not trigger payroll or money
                movement.
              </div>

              {recordsLoading ? (
                <LoadingSkeleton variant="row" count={4} />
              ) : records.length === 0 ? (
                <AppEmptyState
                  title="No commission records"
                  description="Paid invoices generate commission records when an active rule matches the invoice item."
                />
              ) : (
                <AppTable
                  mobileCardMode
                  data={records}
                  keyExtractor={(r) => r.id}
                  columns={[
                    {
                      key: 'provider',
                      header: 'Provider',
                      mobilePrimary: true,
                      render: (record) => (
                        <span className="font-medium">
                          {record.provider.firstName} {record.provider.lastName}
                        </span>
                      ),
                    },
                    {
                      key: 'source',
                      header: 'Source',
                      render: (record) =>
                        record.invoiceItem?.service?.name ??
                        record.invoiceItem?.product?.name ??
                        record.invoiceItem?.package?.name ??
                        'Invoice item',
                    },
                    {
                      key: 'earned',
                      header: 'Earned',
                      mobileLabel: 'Earned on',
                      render: (record) => formatDate(record.earnedAt),
                    },
                    {
                      key: 'basis',
                      header: 'Basis',
                      className: 'text-right',
                      render: (record) => (
                        <span className="md:block md:text-right">
                          {formatMoney(record.basisAmount)}
                        </span>
                      ),
                    },
                    {
                      key: 'commission',
                      header: 'Commission',
                      className: 'text-right',
                      render: (record) => (
                        <span className="font-semibold md:block md:text-right">
                          {formatMoney(record.amount)}
                        </span>
                      ),
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (record) => (
                        <StatusBadge
                          status={record.status === 'PENDING' ? 'UNPAID' : record.status}
                          variant="invoice"
                        />
                      ),
                    },
                    {
                      key: 'paidOut',
                      header: 'Paid Out',
                      render: (record) => formatDate(record.paidOutAt),
                    },
                  ]}
                />
              )}
            </AppCardContent>
          </AppCard>
        </div>
      )}
    </PageContainer>
  )
}
