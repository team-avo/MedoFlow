'use client'

import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppButton, AppInput } from '@/components/ui-system'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { inviteStaff, type StaffRole } from '@/lib/staffApi'
import { listRoles, type CustomRole } from '@/lib/roleApi'
import { getDisciplines } from '@/lib/disciplineApi'
import { getDashboardServices } from '@/lib/serviceApi'
import { useAppToast } from '@/hooks/useAppToast'
import { Shield, ChevronRight } from 'lucide-react'
import Link from 'next/link'

// ─── Form schema ──────────────────────────────────────────────────────────────

const staffSchema = z
  .object({
    createType: z.enum(['staff', 'provider']),
    name: z.string().optional(),
    email: z.string().email('Valid email is required'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    customRoleId: z.string().optional(),
    disciplineIds: z.array(z.string()).optional(),
    serviceIds: z.array(z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.createType !== 'provider' && (!data.name || data.name.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Full name is required',
        path: ['name'],
      })
    }
    if (data.createType !== 'provider' && !data.customRoleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select a role',
        path: ['customRoleId'],
      })
    }
    if (data.createType === 'provider') {
      if (!data.firstName || data.firstName.trim() === '')
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'First name is required',
          path: ['firstName'],
        })
      if (!data.lastName || data.lastName.trim() === '')
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Last name is required',
          path: ['lastName'],
        })
      if (!data.disciplineIds || data.disciplineIds.length === 0)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Select at least one discipline',
          path: ['disciplineIds'],
        })
      if (!data.serviceIds || data.serviceIds.length === 0)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Select at least one service',
          path: ['serviceIds'],
        })
    }
  })

type StaffFormData = z.infer<typeof staffSchema>

// ─── Component ────────────────────────────────────────────────────────────────

export function AddStaffModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const toast = useAppToast()
  const queryClient = useQueryClient()
  const [createType, setCreateType] = useState<'staff' | 'provider'>('staff')
  const [selectedRoleId, setSelectedRoleId] = useState<string>('')

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<StaffFormData>({
    resolver: zodResolver(staffSchema),
    defaultValues: {
      createType: 'staff',
      name: '',
      email: '',
      firstName: '',
      lastName: '',
      customRoleId: '',
      disciplineIds: [],
      serviceIds: [],
    },
  })

  const selectedDisciplineIds = watch('disciplineIds') || []
  const selectedServiceIds = watch('serviceIds') || []

  // Fetch available custom roles
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: listRoles,
    enabled: open && createType === 'staff',
  })

  const { data: disciplines = [], isLoading: disciplinesLoading } = useQuery({
    queryKey: ['disciplines'],
    queryFn: getDisciplines,
    enabled: open && createType === 'provider',
  })

  const { data: allServices = [] } = useQuery({
    queryKey: ['dashboard-services'],
    queryFn: getDashboardServices,
    enabled: open && createType === 'provider',
  })

  const filteredServices = allServices.filter((s) =>
    selectedDisciplineIds.includes(s.discipline.id)
  )

  const selectedRole = roles.find((r) => r.id === selectedRoleId)

  const handleTypeChange = (type: 'staff' | 'provider') => {
    setCreateType(type)
    setValue('createType', type)
  }

  const handleRoleSelect = (roleId: string) => {
    setSelectedRoleId(roleId)
    setValue('customRoleId', roleId)
  }

  const inviteMutation = useMutation({
    mutationFn: (data: any) => inviteStaff(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      reset()
      setSelectedRoleId('')
      setCreateType('staff')
      toast.success('Staff invitation sent')
      onOpenChange(false)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || error.message || 'Unable to invite staff')
    },
  })

  const onSubmit = (data: StaffFormData) => {
    if (createType === 'provider') {
      inviteMutation.mutate({
        ...data,
        role: 'PROVIDER' as StaffRole,
        services: data.serviceIds?.map((id) => ({ serviceId: id })),
      })
    } else {
      inviteMutation.mutate({
        ...data,
        role: 'STAFF' as StaffRole,
        customRoleId: selectedRoleId,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite New Team Member</DialogTitle>
          <DialogDescription>Choose the type of team member and assign a role.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 py-2">
          {/* Type toggle */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Member Type</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  value: 'staff' as const,
                  label: 'Staff',
                  desc: 'Admin, front desk, or custom role',
                },
                {
                  value: 'provider' as const,
                  label: 'Provider',
                  desc: 'Clinical staff / therapist',
                },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className={`flex flex-col cursor-pointer border rounded-xl px-3 py-2.5 transition-colors ${
                    createType === opt.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    value={opt.value}
                    checked={createType === opt.value}
                    onChange={() => handleTypeChange(opt.value)}
                  />
                  <span
                    className={`text-sm font-semibold ${createType === opt.value ? 'text-primary' : 'text-slate-800'}`}
                  >
                    {opt.label}
                  </span>
                  <span className="text-xs text-slate-400 mt-0.5">{opt.desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Email */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <AppInput {...register('email')} placeholder="email@clinic.com" />
            {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
          </div>

          {/* Name fields — type-specific */}
          {createType !== 'provider' ? (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium">Full Name</label>
                <AppInput {...register('name')} placeholder="Jamie Rivera" />
                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
              </div>

              {/* Custom Role Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-slate-700">Assign Role</label>
                  <Link
                    href="/dashboard/staff/roles"
                    className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
                  >
                    Manage Roles <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
                {rolesLoading ? (
                  <p className="py-2 text-center text-xs text-slate-400" role="status">
                    Loading roles…
                  </p>
                ) : roles.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center">
                    <Shield className="h-6 w-6 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">No roles created yet.</p>
                    <Link
                      href="/dashboard/staff/roles"
                      className="text-xs font-medium text-teal-600 hover:text-teal-700"
                    >
                      Create roles first →
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto border rounded-xl p-3 bg-slate-50">
                    {roles.map((role) => (
                      <label
                        key={role.id}
                        className={`flex items-center justify-between cursor-pointer rounded-lg px-3 py-2.5 transition-colors ${
                          selectedRoleId === role.id
                            ? 'bg-teal-50 border border-teal-300 shadow-sm'
                            : 'bg-white border border-transparent hover:border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="radio"
                            name="customRole"
                            value={role.id}
                            checked={selectedRoleId === role.id}
                            onChange={() => handleRoleSelect(role.id)}
                            className="h-4 w-4 text-teal-600 accent-teal-600"
                          />
                          <div>
                            <span className="text-sm font-semibold text-slate-700">
                              {role.name}
                            </span>
                            {role.description && (
                              <p className="text-[11px] text-slate-400">{role.description}</p>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {role.permissions.length} perms
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {errors.customRoleId && (
                  <p className="text-xs text-red-500">{errors.customRoleId.message}</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">First Name</label>
                  <AppInput {...register('firstName')} placeholder="Jamie" />
                  {errors.firstName && (
                    <p className="text-xs text-red-500">{errors.firstName.message}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Last Name</label>
                  <AppInput {...register('lastName')} placeholder="Rivera" />
                  {errors.lastName && (
                    <p className="text-xs text-red-500">{errors.lastName.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Disciplines</label>
                <div className="border rounded-xl p-3 max-h-36 overflow-y-auto space-y-1.5 bg-slate-50">
                  {disciplinesLoading ? (
                    <p className="py-2 text-center text-xs text-slate-400" role="status">
                      Loading disciplines…
                    </p>
                  ) : disciplines.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">
                      No disciplines found. Create one first.
                    </p>
                  ) : (
                    disciplines.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          value={d.id}
                          checked={selectedDisciplineIds.includes(d.id)}
                          onChange={(e) => {
                            const newVal = e.target.checked
                              ? [...selectedDisciplineIds, d.id]
                              : selectedDisciplineIds.filter((id) => id !== d.id)
                            setValue('disciplineIds', newVal)
                          }}
                          className="accent-primary"
                        />
                        {d.name}
                      </label>
                    ))
                  )}
                </div>
                {errors.disciplineIds && (
                  <p className="text-xs text-red-500">{errors.disciplineIds.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Services</label>
                <div className="border rounded-xl p-3 max-h-36 overflow-y-auto space-y-1.5 bg-slate-50">
                  {selectedDisciplineIds.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Select disciplines first.</p>
                  ) : filteredServices.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">
                      No services for selected disciplines.
                    </p>
                  ) : (
                    filteredServices.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          value={s.id}
                          checked={selectedServiceIds.includes(s.id)}
                          onChange={(e) => {
                            const newVal = e.target.checked
                              ? [...selectedServiceIds, s.id]
                              : selectedServiceIds.filter((id) => id !== s.id)
                            setValue('serviceIds', newVal)
                          }}
                          className="accent-primary"
                        />
                        {s.name} <span className="text-slate-400">({s.discipline.name})</span>
                      </label>
                    ))
                  )}
                </div>
                {errors.serviceIds && (
                  <p className="text-xs text-red-500">{errors.serviceIds.message}</p>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <AppButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </AppButton>
            <AppButton
              type="submit"
              disabled={
                inviteMutation.isPending ||
                (createType === 'provider' && disciplines.length === 0) ||
                (createType === 'staff' && roles.length === 0)
              }
            >
              {inviteMutation.isPending ? 'Sending...' : 'Send Invite'}
            </AppButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
