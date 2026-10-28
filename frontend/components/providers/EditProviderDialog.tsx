'use client'

import React, { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { getDisciplines } from '@/lib/disciplineApi'
import { updateProvider, type UpdateProviderPayload } from '@/lib/availabilityApi'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppToast } from '@/hooks/useAppToast'
import { ScrollArea } from '@/components/ui/scroll-area'

const editProviderSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Valid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  disciplineIds: z.array(z.string()).min(1, 'Select at least one discipline'),
})

type EditProviderFormData = z.infer<typeof editProviderSchema>

interface EditProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: {
    id: string
    firstName: string
    lastName: string
    email?: string | null
    clinicId: string
    disciplines?: { discipline: { id: string; name: string } }[]
    discipline?: { id: string; name: string }
  }
}

export function EditProviderDialog({ open, onOpenChange, provider }: EditProviderDialogProps) {
  const queryClient = useQueryClient()
  const toast = useAppToast()

  const { data: disciplines = [], isLoading: disciplinesLoading } = useQuery({
    queryKey: ['disciplines'],
    queryFn: () => getDisciplines(),
    enabled: open,
  })

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditProviderFormData>({
    resolver: zodResolver(editProviderSchema),
    defaultValues: {
      firstName: provider.firstName,
      lastName: provider.lastName,
      email: provider.email ?? '',
      phone: '',
      disciplineIds:
        provider.disciplines?.map((pd) => pd.discipline.id) ??
        (provider.discipline ? [provider.discipline.id] : []),
    },
  })

  const disciplineIds = watch('disciplineIds')

  useEffect(() => {
    if (open && provider) {
      reset({
        firstName: provider.firstName,
        lastName: provider.lastName,
        email: provider.email ?? '',
        phone: '',
        disciplineIds:
          provider.disciplines?.map((pd) => pd.discipline.id) ??
          (provider.discipline ? [provider.discipline.id] : []),
      })
    }
  }, [open, provider, reset])

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateProviderPayload) => updateProvider(provider.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider', provider.id] })
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      onOpenChange(false)
      toast.success('Provider updated')
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast.error(err.response?.data?.message ?? 'Failed to update provider')
    },
  })

  const onSubmit = (data: EditProviderFormData) => {
    updateMutation.mutate({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email || undefined,
      phone: data.phone || undefined,
      disciplineIds: data.disciplineIds,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Provider</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">First name</label>
                <Input {...register('firstName')} className="mt-1" placeholder="First name" />
                {errors.firstName && (
                  <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Last name</label>
                <Input {...register('lastName')} className="mt-1" placeholder="Last name" />
                {errors.lastName && (
                  <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <Input
                {...register('email')}
                type="email"
                className="mt-1"
                placeholder="email@example.com"
              />
              {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Phone</label>
              <Input {...register('phone')} className="mt-1" placeholder="Phone" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Disciplines</label>
              <ScrollArea className="mt-2 max-h-32 rounded border border-gray-200 p-2">
                <div className="space-y-2">
                  {disciplinesLoading && (
                    <p className="text-xs text-gray-400" role="status">
                      Loading disciplines…
                    </p>
                  )}
                  {disciplines.map((d) => (
                    <label key={d.id} className="flex cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={disciplineIds.includes(d.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setValue('disciplineIds', [...disciplineIds, d.id])
                          } else {
                            setValue(
                              'disciplineIds',
                              disciplineIds.filter((id) => id !== d.id)
                            )
                          }
                        }}
                      />
                      <span className="text-sm">{d.name}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
              {errors.disciplineIds && (
                <p className="mt-1 text-sm text-red-600">{errors.disciplineIds.message}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
