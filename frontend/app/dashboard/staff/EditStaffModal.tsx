'use client'

import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppButton } from '@/components/ui-system'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { updateStaff, linkProviderToAdmin, type StaffMember, type StaffRole } from '@/lib/staffApi'
import { listRoles, type CustomRole } from '@/lib/roleApi'
import { useAppToast } from '@/hooks/useAppToast'
import { ShieldCheck, Shield, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: StaffMember
}

export function EditStaffModal({ open, onOpenChange, member }: Props) {
  const toast = useAppToast()
  const queryClient = useQueryClient()

  const [selectedRoleId, setSelectedRoleId] = useState<string>('')

  // Load available roles
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: listRoles,
    enabled: open,
  })

  // Initialise from member
  useEffect(() => {
    if (open) {
      setSelectedRoleId(member.customRoleId ?? '')
    }
  }, [open, member])

  const selectedRole = roles.find((r) => r.id === selectedRoleId)

  const updateMutation = useMutation({
    mutationFn: () => {
      return updateStaff(member.id, { customRoleId: selectedRoleId || undefined })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      toast.success('Staff member updated')
      onOpenChange(false)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message ?? error.message ?? 'Unable to update staff')
    },
  })

  const linkProviderMutation = useMutation({
    mutationFn: () => linkProviderToAdmin(member.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      toast.success('Provider profile linked to this admin')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message ?? error.message ?? 'Unable to link provider')
    },
  })

  const isAdmin = member.role === 'SUPER_ADMIN'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Team Member</DialogTitle>
          <DialogDescription>
            {member.name} · {member.email}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Current role badge */}
          {member.customRole && (
            <div className="rounded-xl border border-teal-200/80 bg-teal-50/30 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-teal-600" />
                <span className="font-semibold text-teal-700">Current Role:</span>
                <span className="font-bold text-teal-800">{member.customRole.name}</span>
              </div>
              {member.customRole.permissions && (
                <p className="mt-1 text-[11px] text-teal-500">
                  {(member.customRole.permissions as string[]).length} permissions assigned
                </p>
              )}
            </div>
          )}

          {/* Role selector (hide for SUPER_ADMIN) */}
          {!isAdmin && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-700">Assign Role</label>
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
                <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto border rounded-xl p-3 bg-slate-50">
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
                          name="editCustomRole"
                          value={role.id}
                          checked={selectedRoleId === role.id}
                          onChange={() => setSelectedRoleId(role.id)}
                          className="h-4 w-4 text-teal-600 accent-teal-600"
                        />
                        <div>
                          <span className="text-sm font-semibold text-slate-700">{role.name}</span>
                          {role.description && (
                            <p className="text-[11px] text-slate-400">{role.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {role.isPreset && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">
                            Preset
                          </span>
                        )}
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {role.permissions.length} perms
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Permission preview for selected role */}
              {selectedRole && (
                <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-3 mt-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                    Permissions Preview
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedRole.permissions.slice(0, 10).map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center rounded-md bg-white border border-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500"
                      >
                        {p.replace('.', ' › ')}
                      </span>
                    ))}
                    {selectedRole.permissions.length > 10 && (
                      <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                        +{selectedRole.permissions.length - 10} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Link-as-provider toggle (admin only) */}
          {isAdmin && (
            <div className="border rounded-xl p-4 bg-blue-50/50 space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-blue-600" />
                <p className="text-sm font-semibold text-slate-800">Provider Access</p>
              </div>
              <p className="text-xs text-slate-500">
                Allow this admin to also act as a clinical provider and appear in scheduling.
              </p>
              {member.provider ? (
                <p className="text-xs font-semibold text-emerald-600">
                  Provider profile already linked.
                </p>
              ) : (
                <AppButton
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  onClick={() => linkProviderMutation.mutate()}
                  disabled={linkProviderMutation.isPending}
                >
                  {linkProviderMutation.isPending ? 'Linking...' : 'Link as Provider'}
                </AppButton>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <AppButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </AppButton>
          <AppButton
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || (!isAdmin && !selectedRoleId)}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </AppButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
