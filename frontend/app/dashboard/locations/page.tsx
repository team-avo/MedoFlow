'use client'

import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useAppToast } from '@/hooks/useAppToast'
import {
  AppPageHeader,
  AppEmptyState,
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
  AppButton,
  AppInput,
  KPIStatCard,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { getCurrentClinic, upsertLaunchLocation } from '@/lib/clinicAdminApi'
import { US_TIMEZONES, US_TIMEZONE_VALUES, DEFAULT_US_TIMEZONE } from '@/lib/constants/timezones'
import { MapPin, Globe, Clock, ShieldCheck, CheckCircle2 } from 'lucide-react'

const launchLocationSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  address: z.string().optional(),
  timezone: z.string().min(1, 'Timezone is required'),
})

type LaunchLocationFormData = z.infer<typeof launchLocationSchema>

function LaunchLocationForm({
  defaultValues,
  onSubmit,
  isSubmitting,
}: {
  defaultValues?: LaunchLocationFormData
  onSubmit: (data: LaunchLocationFormData) => void
  isSubmitting: boolean
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LaunchLocationFormData>({
    resolver: zodResolver(launchLocationSchema),
    defaultValues: defaultValues || {
      name: '',
      address: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_US_TIMEZONE,
    },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <div>
            <label htmlFor="name" className="block text-sm font-bold text-slate-700 mb-1">
              Location Name
            </label>
            <AppInput
              id="name"
              type="text"
              placeholder="e.g. Main Clinic or Virtual Office"
              className="rounded-xl"
              {...register('name')}
            />
            <p className="mt-2 text-xs text-slate-400 font-medium">
              This name will be displayed to patients during the booking flow.
            </p>
            {errors.name && (
              <p className="mt-1 text-xs text-rose-600 font-bold">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="address" className="block text-sm font-bold text-slate-700 mb-1">
              Physical Address (Optional)
            </label>
            <AppInput
              id="address"
              type="text"
              placeholder="123 Clinical Way, Ste 100"
              className="rounded-xl"
              {...register('address')}
            />
            <p className="mt-2 text-xs text-slate-400 font-medium">
              Leave blank if this is an online-only/virtual location.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <label htmlFor="timezone" className="block text-sm font-bold text-slate-700 mb-1">
              Operational Timezone
            </label>
            <select
              id="timezone"
              className="flex h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
              {...register('timezone')}
            >
              {US_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-400 font-medium">
              Ensures appointment reminders and schedules are accurately synchronized.
            </p>
            {errors.timezone && (
              <p className="mt-1 text-xs text-rose-600 font-bold">{errors.timezone.message}</p>
            )}
          </div>

          <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
            <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Location Features
            </h4>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-xs font-bold text-slate-600">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Multi-location backend support
              </li>
              <li className="flex items-center gap-3 text-xs font-bold text-slate-600">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Integrated Virtual Meeting
                URLs
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-8 border-t border-slate-100">
        <AppButton
          type="submit"
          disabled={isSubmitting}
          className="rounded-full px-10 h-12 font-bold shadow-lg"
        >
          {isSubmitting ? 'Updating...' : 'Save Facility Settings'}
        </AppButton>
      </div>
    </form>
  )
}

export default function LocationsPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const toast = useAppToast()

  const { data: clinic, isLoading } = useQuery({
    queryKey: ['admin-clinic', 'current'],
    queryFn: () => getCurrentClinic(),
    enabled: user?.role === 'SUPER_ADMIN' && !!user?.clinicId,
  })

  const saveMutation = useMutation({
    mutationFn: (data: LaunchLocationFormData) =>
      upsertLaunchLocation({
        id: clinic?.launchLocation?.id,
        name: data.name,
        address: data.address || undefined,
        timezone: data.timezone,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-clinic', 'current'] })
      toast.success('Facility settings updated')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Unable to save location')
    },
  })

  const clinicId = user?.clinicId ?? undefined

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="p-8">
        <AppEmptyState
          title="Access Restricted"
          description="Facility management is limited to Super Administrators."
        />
      </div>
    )
  }

  if (!clinicId) {
    return (
      <div className="p-8">
        <AppEmptyState
          title="Clinic Required"
          description="Create your clinic first to configure its primary facility."
        />
      </div>
    )
  }

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Clinic Facility"
        description="Configure your primary operational location and clinical timezone."
      />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <KPIStatCard
          label="Active Facilities"
          value={clinic?.launchLocation ? 1 : 0}
          icon={MapPin}
          iconClassName="text-blue-600 bg-blue-50"
        />
        <KPIStatCard
          label="Primary Timezone"
          value={clinic?.launchLocation?.timezone.split('/').pop()?.replace('_', ' ') || 'Not Set'}
          icon={Clock}
          iconClassName="text-purple-600 bg-purple-50"
        />
        <KPIStatCard
          label="Backend Status"
          value="Online"
          icon={Globe}
          iconClassName="text-emerald-600 bg-emerald-50"
        />
      </div>

      <AppCard className="border-none shadow-sm overflow-hidden bg-white">
        <AppCardHeader className="bg-slate-50/50 border-b-0 py-6 px-8">
          <AppCardTitle className="text-lg font-bold">Facility Configuration</AppCardTitle>
        </AppCardHeader>
        <AppCardContent className="p-8">
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
            </div>
          ) : (
            <LaunchLocationForm
              defaultValues={{
                name: clinic?.launchLocation?.name ?? '',
                address: clinic?.launchLocation?.address ?? '',
                timezone: (() => {
                  const tz = clinic?.launchLocation?.timezone ?? ''
                  return (US_TIMEZONE_VALUES as readonly string[]).includes(tz)
                    ? tz
                    : DEFAULT_US_TIMEZONE
                })(),
              }}
              onSubmit={(values) => saveMutation.mutate(values)}
              isSubmitting={saveMutation.isPending}
            />
          )}
        </AppCardContent>
      </AppCard>
    </PageContainer>
  )
}
