'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AppPageHeader,
  AppEmptyState,
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
  AppButton,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { AppInput } from '@/components/ui-system'
import { useAuth } from '@/contexts/AuthContext'
import { useAppToast } from '@/hooks/useAppToast'
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  seedPresetRoles,
  getPermissionRegistry,
  type CustomRole,
  type PermissionGroup,
  type RolePreset,
} from '@/lib/roleApi'
import { Shield, Plus, Pencil, Trash2, Users, ChevronRight, Sparkles, Check, X } from 'lucide-react'

// ─── Role Card ────────────────────────────────────────────────────────────────

function RoleCard({
  role,
  onEdit,
  onDelete,
}: {
  role: CustomRole
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 transition-colors hover:border-slate-300 hover:shadow-lg hover:shadow-slate-100/50">
      {/* Gradient accent */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-500 opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-50 to-emerald-50 text-teal-600">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">{role.name}</h3>
            {role.description && (
              <p className="mt-0.5 text-xs text-slate-400">{role.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {role.isPreset && (
            <Badge
              variant="secondary"
              className="rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-teal-700 bg-teal-50 border-teal-100"
            >
              Preset
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          <span className="font-semibold text-slate-600">{role.userCount}</span>
          <span>{role.userCount === 1 ? 'member' : 'members'}</span>
        </div>
        <span className="text-slate-200">·</span>
        <span>{role.permissions.length} permissions</span>
      </div>

      {/* Permission preview chips */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {role.permissions.slice(0, 6).map((p) => (
          <span
            key={p}
            className="inline-flex items-center rounded-lg bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500"
          >
            {p.replace('.', ' › ')}
          </span>
        ))}
        {role.permissions.length > 6 && (
          <span className="inline-flex items-center rounded-lg bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
            +{role.permissions.length - 6} more
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <AppButton
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-slate-400 hover:text-teal-600"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </AppButton>
        {role.userCount === 0 && (
          <AppButton
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-slate-400 hover:text-rose-600"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </AppButton>
        )}
      </div>
    </div>
  )
}

// ─── Permission Toggle Grid ──────────────────────────────────────────────────

function PermissionGrid({
  groups,
  selectedPermissions,
  onToggle,
  onToggleAll,
}: {
  groups: PermissionGroup[]
  selectedPermissions: Set<string>
  onToggle: (key: string) => void
  onToggleAll: (keys: string[], checked: boolean) => void
}) {
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const groupKeys = group.permissions.map((p) => p.key)
        const allChecked = groupKeys.every((k) => selectedPermissions.has(k))
        const someChecked = groupKeys.some((k) => selectedPermissions.has(k))

        return (
          <div
            key={group.module}
            className="rounded-xl border border-slate-200/80 bg-white overflow-hidden"
          >
            {/* Group header */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-3">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked && !allChecked
                      }}
                      onChange={() => onToggleAll(groupKeys, !allChecked)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 accent-teal-600"
                    />
                  </div>
                  <span className="text-sm font-bold text-slate-700">{group.label}</span>
                </label>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {groupKeys.filter((k) => selectedPermissions.has(k)).length}/{groupKeys.length}
              </span>
            </div>

            {/* Permission rows */}
            <div className="divide-y divide-slate-50">
              {group.permissions.map((perm) => (
                <label
                  key={perm.key}
                  className="flex cursor-pointer items-center justify-between px-5 py-3 transition-colors hover:bg-teal-50/30"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedPermissions.has(perm.key)}
                      onChange={() => onToggle(perm.key)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 accent-teal-600"
                    />
                    <div>
                      <span className="text-sm font-medium text-slate-700">{perm.label}</span>
                      {perm.description && (
                        <p className="text-[11px] text-slate-400">{perm.description}</p>
                      )}
                    </div>
                  </div>
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                      selectedPermissions.has(perm.key)
                        ? 'bg-teal-100 text-teal-600'
                        : 'bg-slate-100 text-slate-300'
                    }`}
                  >
                    {selectedPermissions.has(perm.key) ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Role Editor Modal ────────────────────────────────────────────────────────

function RoleEditorModal({
  open,
  onOpenChange,
  editingRole,
  groups,
  presets,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRole: CustomRole | null
  groups: PermissionGroup[]
  presets: Record<string, RolePreset>
}) {
  const toast = useAppToast()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set())
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)

  const isEditing = !!editingRole

  useEffect(() => {
    if (open) {
      if (editingRole) {
        setName(editingRole.name)
        setDescription(editingRole.description ?? '')
        setSelectedPermissions(new Set(editingRole.permissions))
        setSelectedPreset(null)
      } else {
        setName('')
        setDescription('')
        setSelectedPermissions(new Set())
        setSelectedPreset(null)
      }
    }
  }, [open, editingRole])

  const handlePresetSelect = (presetKey: string) => {
    const preset = presets[presetKey]
    if (!preset) return
    setSelectedPreset(presetKey)
    if (!name) setName(presetKey)
    if (!description) setDescription(preset.description)
    setSelectedPermissions(new Set(preset.permissions))
  }

  const togglePermission = (key: string) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
    setSelectedPreset(null) // clear preset since user customised
  }

  const toggleAllPermissions = (keys: string[], checked: boolean) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => (checked ? next.add(k) : next.delete(k)))
      return next
    })
    setSelectedPreset(null)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const permissions = Array.from(selectedPermissions)
      if (isEditing) {
        return updateRole(editingRole!.id, { name, description, permissions })
      }
      return createRole({ name, description, permissions, presetKey: selectedPreset ?? undefined })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success(isEditing ? 'Role updated' : 'Role created')
      onOpenChange(false)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message ?? error.message ?? 'Unable to save role')
    },
  })

  const allPermissionKeys = groups.flatMap((g) => g.permissions.map((p) => p.key))
  const allSelected = allPermissionKeys.every((k) => selectedPermissions.has(k))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Role' : 'Create New Role'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Modify the role name, description, and permissions.'
              : 'Choose a preset or build a custom role from scratch.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Preset quick-picks (only for new roles) */}
          {!isEditing && Object.keys(presets).length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Start from a Preset</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {Object.entries(presets).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePresetSelect(key)}
                    className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors ${
                      selectedPreset === key
                        ? 'border-teal-500 bg-teal-50/50 shadow-sm shadow-teal-100'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles
                        className={`h-3.5 w-3.5 ${
                          selectedPreset === key ? 'text-teal-600' : 'text-slate-400'
                        }`}
                      />
                      <span
                        className={`text-sm font-bold ${
                          selectedPreset === key ? 'text-teal-700' : 'text-slate-700'
                        }`}
                      >
                        {key}
                      </span>
                    </div>
                    <span className="mt-1 text-[11px] text-slate-400 line-clamp-1">
                      {preset.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Name + Description */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">Role Name</label>
              <AppInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Operations Manager"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">Description</label>
              <AppInput
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description..."
              />
            </div>
          </div>

          {/* Select All */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => toggleAllPermissions(allPermissionKeys, !allSelected)}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 accent-teal-600"
              />
              <span className="text-sm font-bold text-slate-600">Select All Permissions</span>
            </label>
            <span className="text-xs font-semibold text-slate-400">
              {selectedPermissions.size}/{allPermissionKeys.length} selected
            </span>
          </div>

          {/* Permission grid */}
          <PermissionGrid
            groups={groups}
            selectedPermissions={selectedPermissions}
            onToggle={togglePermission}
            onToggleAll={toggleAllPermissions}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <AppButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </AppButton>
          <AppButton
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !name.trim() || selectedPermissions.size === 0}
          >
            {saveMutation.isPending ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Role'}
          </AppButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RolesPage() {
  const { user } = useAuth()
  const toast = useAppToast()
  const queryClient = useQueryClient()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null)

  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: listRoles,
    enabled: !!user?.clinicId,
  })

  const { data: registry } = useQuery({
    queryKey: ['permission-registry'],
    queryFn: getPermissionRegistry,
    enabled: !!user?.clinicId,
  })

  const seedMutation = useMutation({
    mutationFn: seedPresetRoles,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Preset roles synced')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message ?? 'Unable to sync presets')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Role deleted')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message ?? 'Unable to delete role')
    },
  })

  const handleDelete = (role: CustomRole) => {
    if (window.confirm(`Delete the "${role.name}" role? This cannot be undone.`)) {
      deleteMutation.mutate(role.id)
    }
  }

  const handleEdit = (role: CustomRole) => {
    setEditingRole(role)
    setIsModalOpen(true)
  }

  const handleCreate = () => {
    setEditingRole(null)
    setIsModalOpen(true)
  }

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="p-8">
        <AppEmptyState
          title="Access Restricted"
          description="Only administrators can manage roles and permissions."
        />
      </div>
    )
  }

  if (rolesLoading) {
    return (
      <div className="p-8 flex justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-teal-500" />
      </div>
    )
  }

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Roles & Permissions"
        description="Define custom roles with granular permissions — just like Shopify."
        actions={
          <div className="flex flex-wrap gap-2">
            {roles.filter((r) => r.isPreset).length === 0 && (
              <AppButton
                variant="outline"
                className="rounded-full px-5 hover:bg-teal-50 hover:text-teal-600 hover:border-teal-200"
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {seedMutation.isPending ? 'Syncing...' : 'Load Presets'}
              </AppButton>
            )}
            <AppButton onClick={handleCreate} className="rounded-full px-6 shadow-md">
              <Plus className="mr-2 h-4 w-4" />
              Create Role
            </AppButton>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-5">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
            Total Roles
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900">{roles.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-5">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
            Preset Roles
          </p>
          <p className="mt-1 text-2xl font-black text-teal-600">
            {roles.filter((r) => r.isPreset).length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-5">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
            Custom Roles
          </p>
          <p className="mt-1 text-2xl font-black text-purple-600">
            {roles.filter((r) => !r.isPreset).length}
          </p>
        </div>
      </div>

      {/* Role grid */}
      {roles.length === 0 ? (
        <AppCard className="border-none shadow-sm bg-white">
          <AppCardContent className="py-16">
            <AppEmptyState
              title="No roles yet"
              description="Load preset roles or create your first custom role to get started."
            />
          </AppCardContent>
        </AppCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              onEdit={() => handleEdit(role)}
              onDelete={() => handleDelete(role)}
            />
          ))}
        </div>
      )}

      {/* Role Editor Modal */}
      {registry && (
        <RoleEditorModal
          open={isModalOpen}
          onOpenChange={(open) => {
            setIsModalOpen(open)
            if (!open) setEditingRole(null)
          }}
          editingRole={editingRole}
          groups={registry.groups}
          presets={registry.presets}
        />
      )}
    </PageContainer>
  )
}
