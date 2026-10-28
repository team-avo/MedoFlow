'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getDashboardServices,
  createService,
  updateService,
  archiveService,
  type DashboardService,
  type CreateServicePayload,
  type UpdateServicePayload,
} from '@/lib/serviceApi'
import { getDisciplines } from '@/lib/disciplineApi'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useAppToast } from '@/hooks/useAppToast'
import { useSystemModal } from '@/hooks/useSystemModal'
import {
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
  AppButton,
  AppInput,
  AppPageHeader,
  AppEmptyState,
  AppTable,
  KPIStatCard,
  DateRangeFilter,
} from '@/components/ui-system'
import type { DateRangeOption, DateRange } from '@/components/ui-system/DateRangeFilter'
import { PageContainer } from '@/components/layout'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ClipboardList, Stethoscope, Clock, Plus, Edit2, Trash2 } from 'lucide-react'

const serviceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  duration: z.coerce.number().min(1, 'Duration must be at least 1'),
  defaultPrice: z.string().min(1, 'Price is required'),
  disciplineId: z.string().min(1, 'Discipline is required'),
  recommendedProductIds: z.array(z.string()).optional(),
})

type ServiceFormData = z.infer<typeof serviceSchema>

function ServiceForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  submitLabel,
  disciplines,
  products,
}: {
  defaultValues?: Partial<ServiceFormData>
  onSubmit: (data: ServiceFormData) => void
  isSubmitting: boolean
  submitLabel: string
  disciplines: { id: string; name: string }[]
  products: { id: string; name: string }[]
}) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: defaultValues || {
      name: '',
      duration: 30,
      defaultPrice: '',
      disciplineId: '',
      recommendedProductIds: [],
    },
  })

  const disciplineId = watch('disciplineId')
  const selectedProductIds = watch('recommendedProductIds') || []

  const toggleProduct = (productId: string) => {
    if (selectedProductIds.includes(productId)) {
      setValue(
        'recommendedProductIds',
        selectedProductIds.filter((id) => id !== productId)
      )
    } else {
      setValue('recommendedProductIds', [...selectedProductIds, productId])
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Service Name</label>
          <AppInput
            {...register('name')}
            placeholder="e.g. Initial Consultation"
            className="rounded-xl"
          />
          {errors.name && (
            <p className="mt-1 text-xs text-rose-600 font-medium">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Clinical Discipline</label>
          <Select
            value={disciplineId}
            onValueChange={(v) => setValue('disciplineId', v, { shouldValidate: true })}
          >
            <SelectTrigger className="rounded-xl h-11">
              <SelectValue placeholder="Select discipline" />
            </SelectTrigger>
            <SelectContent>
              {disciplines.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.disciplineId && (
            <p className="mt-1 text-xs text-rose-600 font-medium">{errors.disciplineId.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Duration (min)</label>
            <AppInput type="number" min={1} {...register('duration')} className="rounded-xl" />
            {errors.duration && (
              <p className="mt-1 text-xs text-rose-600 font-medium">{errors.duration.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Default Price ($)</label>
            <AppInput
              type="text"
              placeholder="0.00"
              {...register('defaultPrice')}
              className="rounded-xl"
            />
            {errors.defaultPrice && (
              <p className="mt-1 text-xs text-rose-600 font-medium">
                {errors.defaultPrice.message}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">
            Cross-sell Recommendations
          </label>
          <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto p-4 bg-slate-50 rounded-2xl border border-slate-100">
            {products.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-3 cursor-pointer p-2 hover:bg-white rounded-xl transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedProductIds.includes(p.id)}
                  onChange={() => toggleProduct(p.id)}
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-slate-700">{p.name}</span>
              </label>
            ))}
            {products.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-4 italic">
                No products available
              </p>
            )}
          </div>
        </div>
      </div>

      <DialogFooter className="pt-4 border-t border-slate-100">
        <AppButton
          type="submit"
          disabled={isSubmitting}
          className="rounded-full px-8 shadow-lg font-bold"
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </AppButton>
      </DialogFooter>
    </form>
  )
}

export default function ServicesPage() {
  const { user } = useAuth()
  const { showModal } = useSystemModal()
  const toast = useAppToast()
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<DashboardService | null>(null)

  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>('ALL_TIME')
  const [dateRangeValues, setDateRangeValues] = useState<DateRange>({})

  const clinicId = user?.clinicId ?? undefined
  const canEdit = user?.role === 'SUPER_ADMIN'

  const {
    data: services = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['services'],
    queryFn: () => getDashboardServices(),
    enabled: !!clinicId,
  })

  const { data: disciplines = [] } = useQuery({
    queryKey: ['disciplines'],
    queryFn: () => getDisciplines(),
    enabled: !!clinicId,
  })

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await api.get('/products')
      return res.data.data.products
    },
    enabled: !!clinicId,
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateServicePayload) => createService(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      setAddOpen(false)
      toast.success('Service created')
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to create service'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateServicePayload }) =>
      updateService(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      setEditOpen(false)
      setEditing(null)
      toast.success('Service updated')
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to update service'),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveService(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      toast.success('Service archived')
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to archive service'),
  })

  const filteredServices = services.filter((s) => {
    if (!dateRangeValues.startDate || !dateRangeValues.endDate) return true
    const createdAt = new Date(s.createdAt)
    return createdAt >= dateRangeValues.startDate && createdAt <= dateRangeValues.endDate
  })

  const handleAddSubmit = (data: ServiceFormData) => {
    createMutation.mutate({
      name: data.name,
      duration: data.duration,
      defaultPrice: data.defaultPrice,
      disciplineId: data.disciplineId,
      recommendedProductIds: data.recommendedProductIds,
    })
  }

  const handleEditSubmit = (data: ServiceFormData) => {
    if (!editing) return
    updateMutation.mutate({
      id: editing.id,
      data: {
        name: data.name,
        duration: data.duration,
        defaultPrice: data.defaultPrice,
        disciplineId: data.disciplineId,
        recommendedProductIds: data.recommendedProductIds,
      },
    })
  }

  if (!clinicId) {
    return (
      <div className="p-8">
        <AppEmptyState title="Setup Required" description="Assign a clinic to manage services." />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
      </div>
    )
  }

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Clinical Services"
        description="Configure your medical offerings, pricing, and durations."
        actions={
          <div className="flex flex-wrap gap-4 items-center">
            <DateRangeFilter
              value={dateRangeOption}
              onChange={(opt, range) => {
                setDateRangeOption(opt)
                setDateRangeValues(range)
              }}
            />
            {canEdit && (
              <>
                <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
                <AppButton onClick={() => setAddOpen(true)} className="rounded-full px-6 shadow-md">
                  <Plus className="mr-2 h-4 w-4" /> Add Service
                </AppButton>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <KPIStatCard
          label="Total Services"
          value={filteredServices.length}
          icon={ClipboardList}
          iconClassName="text-blue-600 bg-blue-50"
        />
        <KPIStatCard
          label="Disciplines"
          value={disciplines.length}
          icon={Stethoscope}
          iconClassName="text-purple-600 bg-purple-50"
        />
        <KPIStatCard
          label="Avg. Session"
          value={`${Math.round(filteredServices.reduce((acc, s) => acc + s.duration, 0) / (filteredServices.length || 1))}m`}
          icon={Clock}
          iconClassName="text-amber-600 bg-amber-50"
        />
      </div>

      <AppCard className="border-none shadow-sm overflow-hidden">
        <AppCardHeader className="bg-white border-b-0 py-6 px-8">
          <AppCardTitle className="text-lg font-bold">Service Catalog</AppCardTitle>
        </AppCardHeader>
        <AppCardContent className="p-0">
          <AppTable<DashboardService>
            mobileCardMode
            columns={[
              {
                key: 'name',
                header: 'Service Name',
                mobilePrimary: true,
                render: (s) => (
                  <div>
                    <p className="font-bold text-slate-900">{s.name}</p>
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-0.5">
                      {s.discipline.name}
                    </p>
                  </div>
                ),
              },
              {
                key: 'duration',
                header: 'Duration',
                render: (s) => <span className="font-medium text-slate-600">{s.duration} min</span>,
              },
              {
                key: 'price',
                header: 'Base Price',
                render: (s) => <span className="font-black text-slate-900">${s.defaultPrice}</span>,
              },
              {
                key: 'actions',
                header: '',
                className: 'text-right',
                render: (s) => (
                  <div className="flex justify-end gap-2 pr-4">
                    <AppButton
                      variant="ghost"
                      size="icon"
                      className="rounded-full hover:bg-slate-50"
                      onClick={() => {
                        setEditing(s)
                        setEditOpen(true)
                      }}
                    >
                      <Edit2 className="h-4 w-4" />
                    </AppButton>
                    <AppButton
                      variant="ghost"
                      size="icon"
                      className="rounded-full hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                      onClick={() =>
                        showModal({
                          title: 'Archive Service',
                          description: 'Are you sure?',
                          onAction: () => archiveMutation.mutate(s.id),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </AppButton>
                  </div>
                ),
              },
            ]}
            data={filteredServices}
            keyExtractor={(s) => s.id}
          />
        </AppCardContent>
      </AppCard>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md rounded-[2rem] p-0 overflow-hidden border-none shadow-lg">
          <DialogHeader className="bg-slate-900 text-white p-8 border-none">
            <DialogTitle className="text-2xl font-black">Create Service</DialogTitle>
          </DialogHeader>
          <div className="p-8">
            <ServiceForm
              disciplines={disciplines}
              products={products}
              onSubmit={handleAddSubmit}
              isSubmitting={createMutation.isPending}
              submitLabel="Create Service"
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md rounded-[2rem] p-0 overflow-hidden border-none shadow-lg">
          <DialogHeader className="bg-slate-900 text-white p-8 border-none">
            <DialogTitle className="text-2xl font-black">Edit Service</DialogTitle>
          </DialogHeader>
          <div className="p-8">
            {editing && (
              <ServiceForm
                defaultValues={{
                  name: editing.name,
                  duration: editing.duration,
                  defaultPrice: editing.defaultPrice,
                  disciplineId: editing.discipline.id,
                  recommendedProductIds: editing.recommendedProducts?.map((p) => p.id) || [],
                }}
                disciplines={disciplines}
                products={products}
                onSubmit={handleEditSubmit}
                isSubmitting={updateMutation.isPending}
                submitLabel="Save Changes"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
