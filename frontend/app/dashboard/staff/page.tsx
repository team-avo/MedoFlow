'use client'

import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AppPageHeader,
  AppEmptyState,
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
  AppButton,
  KPIStatCard,
  AppTable,
  DateRangeFilter,
} from '@/components/ui-system'
import type { DateRangeOption, DateRange } from '@/components/ui-system/DateRangeFilter'
import { PageContainer } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/contexts/AuthContext'
import { listStaff, deactivateStaff } from '@/lib/staffApi'
import { useAppToast } from '@/hooks/useAppToast'
import {
  Trash2,
  UserPlus,
  ShieldCheck,
  Users,
  Clock,
  Pencil,
  Shield,
  Stethoscope,
  Calendar,
} from 'lucide-react'
import Link from 'next/link'
import { AddStaffModal } from './AddStaffModal'
import { EditStaffModal } from './EditStaffModal'
import { cn } from '@/lib/utils'
import type { StaffMember } from '@/lib/staffApi'

export default function StaffPage() {
  const { user } = useAuth()
  const toast = useAppToast()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<StaffMember | null>(null)

  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>('ALL_TIME')
  const [dateRangeValues, setDateRangeValues] = useState<DateRange>({})

  const {
    data: staff = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['staff'],
    queryFn: () => listStaff(),
    enabled: !!user?.clinicId,
  })

  const deactivateMutation = useMutation({
    mutationFn: deactivateStaff,
    onSuccess: () => {
      toast.success('Team member deactivated')
      refetch()
    },
    onError: () => toast.error('Failed to deactivate member'),
  })

  const filteredKPIStaff = staff.filter((s) => {
    if (!dateRangeValues.startDate || !dateRangeValues.endDate) return true
    const createdAt = new Date(s.createdAt)
    return createdAt >= dateRangeValues.startDate && createdAt <= dateRangeValues.endDate
  })

  const handleDeactivate = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to deactivate ${name}?`)) {
      deactivateMutation.mutate(id)
    }
  }

  const isAuthorized = user?.role === 'SUPER_ADMIN' || user?.role === 'FRONT_DESK'

  if (!isAuthorized) {
    return (
      <div className="p-8">
        <AppEmptyState
          title="Access Restricted"
          description="Only administrators can manage clinic staff."
        />
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
        title="Internal Team"
        description="Manage your clinic's administrators and operational support staff."
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
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/staff/roles">
                <AppButton variant="outline" className="rounded-full px-5">
                  <Shield className="mr-2 h-4 w-4" />
                  Manage Roles
                </AppButton>
              </Link>
              <AppButton
                onClick={() => setIsModalOpen(true)}
                className="rounded-full px-6 shadow-md"
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Invite Member
              </AppButton>
            </div>
          </div>
        }
      />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <KPIStatCard
          label="Team Size"
          value={filteredKPIStaff.length}
          icon={Users}
          iconClassName="text-blue-600 bg-blue-50"
        />
        <KPIStatCard
          label="Admins"
          value={filteredKPIStaff.filter((s) => s.role === 'SUPER_ADMIN').length}
          icon={ShieldCheck}
          iconClassName="text-purple-600 bg-purple-50"
        />
        <KPIStatCard
          label="Providers"
          value={filteredKPIStaff.filter((s) => !!s.provider).length}
          icon={Stethoscope}
          iconClassName="text-emerald-600 bg-emerald-50"
        />
      </div>

      <AppCard className="border-none shadow-sm overflow-hidden bg-white">
        <AppCardHeader className="bg-white border-b-0 py-6 px-8">
          <AppCardTitle className="text-lg font-bold">Member Directory</AppCardTitle>
        </AppCardHeader>
        <AppCardContent className="p-0">
          <AppTable
            mobileCardMode
            columns={[
              {
                key: 'member',
                header: 'Member',
                mobilePrimary: true,
                render: (m) => (
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 flex items-center justify-center font-black text-slate-500">
                      {m.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="max-w-[16rem] truncate font-bold text-slate-900">{m.name}</p>
                      <p className="max-w-[16rem] truncate text-xs text-slate-500 font-medium">
                        {m.email}
                      </p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'role',
                header: 'Role',
                render: (m) => (
                  <div className="flex flex-col gap-1">
                    {m.customRole ? (
                      <span className="text-sm font-semibold text-slate-700">
                        {m.customRole.name}
                      </span>
                    ) : (
                      <Badge
                        className="rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-widest w-fit"
                        variant={
                          m.role === 'SUPER_ADMIN'
                            ? 'default'
                            : m.role === 'PROVIDER'
                              ? 'outline'
                              : 'secondary'
                        }
                      >
                        {m.role.replace('_', ' ')}
                      </Badge>
                    )}
                  </div>
                ),
              },
              {
                key: 'clinicalProfile',
                header: 'Clinical Profile',
                render: (m) => {
                  if (!m.provider) {
                    return <span className="text-[11px] font-medium text-slate-400">—</span>
                  }

                  const disciplines = m.provider.disciplines?.map((d) => d.discipline.name) || []
                  const servicesCount = m.provider.providerServices?.length || 0

                  return (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap gap-1">
                        {disciplines.length > 0 ? (
                          disciplines.map((d) => (
                            <span
                              key={d}
                              className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 border border-teal-100/50"
                            >
                              {d}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                            <Stethoscope className="h-3 w-3 text-slate-400" />
                            Provider
                          </span>
                        )}
                      </div>
                      {servicesCount > 0 && (
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {servicesCount} {servicesCount === 1 ? 'Service' : 'Services'}
                        </span>
                      )}
                    </div>
                  )
                },
              },
              {
                key: 'joined',
                header: 'Joined On',
                render: (m) => (
                  <span className="text-xs font-medium text-slate-400">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                className: 'text-right',
                render: (m) => (
                  <div className="flex items-center justify-end gap-1 pr-4">
                    {m.provider && (
                      <Link href={`/dashboard/providers/${m.provider.id}/availability`}>
                        <AppButton
                          variant="ghost"
                          size="sm"
                          className="mr-2 rounded-full font-bold text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                        >
                          <Calendar className="mr-2 h-3.5 w-3.5" />
                          Availability
                        </AppButton>
                      </Link>
                    )}
                    <AppButton
                      variant="ghost"
                      size="icon"
                      className="rounded-full text-slate-400 hover:text-primary"
                      onClick={() => setEditingMember(m)}
                    >
                      <Pencil className="h-4 w-4" />
                    </AppButton>
                    {m.id !== user?.id && m.role !== 'SUPER_ADMIN' ? (
                      <AppButton
                        variant="ghost"
                        size="icon"
                        className="rounded-full text-slate-400 hover:text-rose-600"
                        onClick={() => handleDeactivate(m.id, m.name)}
                        disabled={deactivateMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </AppButton>
                    ) : (
                      <div className="w-8 h-8" />
                    )}
                  </div>
                ),
              },
            ]}
            data={staff}
            keyExtractor={(m) => m.id}
          />
        </AppCardContent>
      </AppCard>

      <AddStaffModal open={isModalOpen} onOpenChange={setIsModalOpen} />

      {editingMember && (
        <EditStaffModal
          open={!!editingMember}
          onOpenChange={(open) => {
            if (!open) setEditingMember(null)
          }}
          member={editingMember}
        />
      )}
    </PageContainer>
  )
}
