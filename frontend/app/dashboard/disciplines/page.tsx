'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getDisciplines,
  createDiscipline,
  updateDiscipline,
  deleteDiscipline,
  type Discipline,
} from '@/lib/disciplineApi'
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
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Stethoscope, ClipboardList, Plus, Edit2, Trash2, Calendar } from 'lucide-react'

const disciplineSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
})

type DisciplineFormData = z.infer<typeof disciplineSchema>

function DisciplineForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  submitLabel,
}: {
  defaultValues?: DisciplineFormData
  onSubmit: (data: DisciplineFormData) => void
  isSubmitting: boolean
  submitLabel: string
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DisciplineFormData>({
    resolver: zodResolver(disciplineSchema),
    defaultValues: defaultValues || { name: '', description: '' },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Discipline Name</label>
          <AppInput
            {...register('name')}
            placeholder="e.g. Physical Therapy"
            className="rounded-xl"
          />
          {errors.name && (
            <p className="mt-1 text-xs text-rose-600 font-medium">{errors.name.message}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Description</label>
          <textarea
            rows={3}
            className="block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-600 outline-none focus:ring-1 focus:ring-primary-600 transition-colors"
            placeholder="Brief overview of this clinical discipline..."
            {...register('description')}
          />
        </div>
      </div>
      <div className="flex justify-end pt-4 border-t border-slate-100">
        <AppButton
          type="submit"
          disabled={isSubmitting}
          className="rounded-full px-8 shadow-lg font-bold"
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </AppButton>
      </div>
    </form>
  )
}

export default function DisciplinesPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const toast = useAppToast()
  const { showModal } = useSystemModal()
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingDiscipline, setEditingDiscipline] = useState<Discipline | null>(null)

  const clinicId = user?.clinicId ?? undefined

  const {
    data: disciplines = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['disciplines'],
    queryFn: getDisciplines,
    enabled: !!clinicId,
  })

  const createMutation = useMutation({
    mutationFn: createDiscipline,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disciplines'] })
      setAddModalOpen(false)
      toast.success('Discipline created successfully')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string } }) =>
      updateDiscipline(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disciplines'] })
      setEditModalOpen(false)
      setEditingDiscipline(null)
      toast.success('Discipline updated successfully')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDiscipline,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disciplines'] })
      toast.success('Discipline archived successfully')
    },
  })

  const handleEditClick = (discipline: Discipline) => {
    setEditingDiscipline(discipline)
    setEditModalOpen(true)
  }

  const handleDeleteClick = (id: string) => {
    showModal({
      title: 'Archive Discipline',
      description:
        'Archive this discipline? Historical records remain intact, but it will be hidden from future setup and booking flows.',
      actionLabel: 'Archive',
      onAction: () => deleteMutation.mutate(id),
    })
  }

  if (!clinicId) {
    return (
      <div className="p-8">
        <AppEmptyState
          title="Setup Required"
          description="Assign a clinic to manage disciplines."
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
        title="Clinical Disciplines"
        description="Categorize your medical services into specialized disciplines."
        actions={
          <AppButton onClick={() => setAddModalOpen(true)} className="rounded-full px-6 shadow-md">
            <Plus className="mr-2 h-4 w-4" /> Add Discipline
          </AppButton>
        }
      />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <KPIStatCard
          label="Total Disciplines"
          value={disciplines.length}
          icon={Stethoscope}
          iconClassName="text-purple-600 bg-purple-50"
        />
        <KPIStatCard
          label="Active Services"
          value="..."
          icon={ClipboardList}
          iconClassName="text-blue-600 bg-blue-50"
          description="Distributed across specialties"
        />
        <KPIStatCard
          label="Last Update"
          value="Today"
          icon={Calendar}
          iconClassName="text-emerald-600 bg-emerald-50"
        />
      </div>

      <AppCard className="border-none shadow-sm overflow-hidden">
        <AppCardHeader className="bg-white border-b-0 py-6 px-8">
          <AppCardTitle className="text-lg font-bold text-slate-900">
            Registered Disciplines
          </AppCardTitle>
        </AppCardHeader>
        <AppCardContent className="p-0">
          <AppTable<Discipline>
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (d) => <span className="font-bold text-slate-900">{d.name}</span>,
              },
              {
                key: 'description',
                header: 'Description',
                render: (d) => (
                  <span className="text-sm text-slate-500 line-clamp-1 max-w-xs">
                    {d.description || '—'}
                  </span>
                ),
              },
              {
                key: 'created',
                header: 'Created On',
                render: (d) => (
                  <span className="text-xs font-medium text-slate-400">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                className: 'text-right',
                render: (d) => (
                  <div className="flex justify-end gap-2 pr-4">
                    <AppButton
                      variant="ghost"
                      size="icon"
                      className="rounded-full"
                      onClick={() => handleEditClick(d)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </AppButton>
                    <AppButton
                      variant="ghost"
                      size="icon"
                      className="rounded-full text-slate-400 hover:text-rose-600"
                      onClick={() => handleDeleteClick(d.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </AppButton>
                  </div>
                ),
              },
            ]}
            data={disciplines}
            keyExtractor={(d) => d.id}
          />
        </AppCardContent>
      </AppCard>

      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="max-w-md rounded-[2rem] p-0 overflow-hidden border-none shadow-lg">
          <DialogHeader className="bg-slate-900 text-white p-8 border-none">
            <DialogTitle className="text-2xl font-black">Add Discipline</DialogTitle>
          </DialogHeader>
          <div className="p-8">
            <DisciplineForm
              onSubmit={(data) => createMutation.mutate(data)}
              isSubmitting={createMutation.isPending}
              submitLabel="Create Discipline"
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editModalOpen}
        onOpenChange={(open) => {
          setEditModalOpen(open)
          if (!open) setEditingDiscipline(null)
        }}
      >
        <DialogContent className="max-w-md rounded-[2rem] p-0 overflow-hidden border-none shadow-lg">
          <DialogHeader className="bg-slate-900 text-white p-8 border-none">
            <DialogTitle className="text-2xl font-black">Edit Discipline</DialogTitle>
          </DialogHeader>
          <div className="p-8">
            {editingDiscipline && (
              <DisciplineForm
                defaultValues={{
                  name: editingDiscipline.name,
                  description: editingDiscipline.description ?? '',
                }}
                onSubmit={(data) => updateMutation.mutate({ id: editingDiscipline.id, data })}
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
