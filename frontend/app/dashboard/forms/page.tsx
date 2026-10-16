'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, GripVertical } from 'lucide-react'

let _idCounter = 0
const genId = () => `field_${Date.now()}_${++_idCounter}`
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  disableTemplate,
  type FormTemplate,
  type FormFieldDefinition,
  type FormScope,
  type CreateTemplatePayload,
} from '@/lib/formsApi'
import { getDisciplines } from '@/lib/disciplineApi'
import { formTemplateCreatePayloadSchema } from '@/lib/schemas/clinicalRecords'
import { getDashboardServices } from '@/lib/serviceApi'
import { useAppToast } from '@/hooks/useAppToast'
import { useSystemModal } from '@/hooks/useSystemModal'
import {
  AppCard,
  AppCardHeader,
  AppCardContent,
  AppButton,
  AppInput,
  AppPageHeader,
  AppEmptyState,
  AppBadge,
  AppTable,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'

// ── Field type options ─────────────────────────────────────────────────────────

const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'select', label: 'Dropdown' },
] as const

type FieldType = FormFieldDefinition['type']

// ── Field editor row ───────────────────────────────────────────────────────────

function FieldRow({
  field,
  index,
  onChange,
  onRemove,
}: {
  field: FormFieldDefinition
  index: number
  onChange: (updated: FormFieldDefinition) => void
  onRemove: () => void
}) {
  const [optionsText, setOptionsText] = useState(
    field.options?.map((o) => o.label).join('\n') ?? ''
  )

  const handleOptionsBlur = () => {
    const options = optionsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ value: line.toLowerCase().replace(/\s+/g, '_'), label: line }))
    onChange({ ...field, options })
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <GripVertical className="mt-2 h-4 w-4 shrink-0 text-slate-400" />
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">Field label</label>
              <AppInput
                value={field.label}
                onChange={(e) => onChange({ ...field, label: e.target.value })}
                placeholder={`Field ${index + 1}`}
              />
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <Select
                value={field.type}
                onValueChange={(val) =>
                  onChange({
                    ...field,
                    type: val as FieldType,
                    options: val === 'select' ? [] : undefined,
                  })
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <Checkbox
                  checked={field.required ?? false}
                  onCheckedChange={(checked) => onChange({ ...field, required: checked === true })}
                />
                Required
              </label>
            </div>
          </div>
          {field.type !== 'checkbox' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Placeholder</label>
              <AppInput
                value={field.placeholder ?? ''}
                onChange={(e) => onChange({ ...field, placeholder: e.target.value })}
                placeholder="Optional placeholder text"
              />
            </div>
          )}
          {field.type === 'select' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Options (one per line)
              </label>
              <textarea
                rows={3}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                onBlur={handleOptionsBlur}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Option one&#10;Option two&#10;Option three"
              />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="mt-1 rounded p-1 text-slate-400 hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ── Template form schema ───────────────────────────────────────────────────────

const templateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  scope: z.enum(['CLINIC', 'DISCIPLINE', 'SERVICE']),
  disciplineId: z.string().optional(),
  serviceId: z.string().optional(),
})

type TemplateFormData = z.infer<typeof templateSchema>

// ── Template dialog ────────────────────────────────────────────────────────────

function TemplateDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: FormTemplate | null
}) {
  const queryClient = useQueryClient()
  const toast = useAppToast()

  const [fields, setFields] = useState<FormFieldDefinition[]>(editing?.fields ?? [])

  const { data: disciplines = [] } = useQuery({
    queryKey: ['disciplines'],
    queryFn: getDisciplines,
    enabled: open,
  })

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: getDashboardServices,
    enabled: open,
  })

  const {
    register,
    handleSubmit,
    watch,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TemplateFormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      scope: (editing?.scope as FormScope) ?? 'CLINIC',
      disciplineId: editing?.discipline?.id ?? '',
      serviceId: editing?.service?.id ?? '',
    },
  })

  const scope = watch('scope')

  // Reset form + fields when dialog opens/closes or editing target changes
  React.useEffect(() => {
    if (open) {
      reset({
        name: editing?.name ?? '',
        description: editing?.description ?? '',
        scope: (editing?.scope as FormScope) ?? 'CLINIC',
        disciplineId: editing?.discipline?.id ?? '',
        serviceId: editing?.service?.id ?? '',
      })
      setFields(editing?.fields ?? [])
    }
  }, [open, editing, reset])

  const saveMutation = useMutation({
    mutationFn: (payload: CreateTemplatePayload) =>
      editing ? updateTemplate(editing.id, payload) : createTemplate(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formTemplates'] })
      onOpenChange(false)
      toast.success(editing ? 'Template updated' : 'Template created')
    },
    onError: () => toast.error('Failed to save template'),
  })

  const onSubmit = (data: TemplateFormData) => {
    if (fields.length === 0) {
      toast.error('Add at least one field')
      return
    }
    const payload: CreateTemplatePayload = {
      name: data.name,
      description: data.description || undefined,
      scope: data.scope,
      fields,
      ...(data.scope === 'DISCIPLINE' && data.disciplineId
        ? { disciplineId: data.disciplineId }
        : {}),
      ...(data.scope === 'SERVICE' && data.serviceId ? { serviceId: data.serviceId } : {}),
    }
    // Same rules as the API (F3.2): every field labelled, selects have options.
    const checked = formTemplateCreatePayloadSchema.safeParse(payload)
    if (!checked.success) {
      toast.error(checked.error.issues[0]?.message ?? 'Please check the form fields')
      return
    }
    saveMutation.mutate(payload)
  }

  const addField = () => {
    setFields((prev) => [...prev, { id: genId(), type: 'text', label: '', required: false }])
  }

  const updateField = (index: number, updated: FormFieldDefinition) => {
    setFields((prev) => prev.map((f, i) => (i === index ? updated : f)))
  }

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Template' : 'New Form Template'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-2">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700">Name</label>
            <AppInput className="mt-1" {...register('name')} />
            {errors.name && <p className="mt-1 text-sm text-danger">{errors.name.message}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Description <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              rows={2}
              className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              {...register('description')}
            />
          </div>

          {/* Scope */}
          <div>
            <label className="block text-sm font-medium text-slate-700">Scope</label>
            <p className="text-xs text-slate-500 mb-1">
              Controls when this form is shown to patients.
            </p>
            <Controller
              control={control}
              name="scope"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CLINIC">Clinic-wide (all bookings)</SelectItem>
                    <SelectItem value="DISCIPLINE">Discipline (specific discipline)</SelectItem>
                    <SelectItem value="SERVICE">Service (specific service)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Discipline selector */}
          {scope === 'DISCIPLINE' && (
            <div>
              <label className="block text-sm font-medium text-slate-700">Discipline</label>
              <Controller
                control={control}
                name="disciplineId"
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger className="mt-1 h-9">
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
                )}
              />
            </div>
          )}

          {/* Service selector */}
          {scope === 'SERVICE' && (
            <div>
              <label className="block text-sm font-medium text-slate-700">Service</label>
              <Controller
                control={control}
                name="serviceId"
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue placeholder="Select service" />
                    </SelectTrigger>
                    <SelectContent>
                      {services.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}

          {/* Field builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-700">
                Fields <span className="font-normal text-slate-400">({fields.length})</span>
              </label>
              <AppButton type="button" size="sm" variant="outline" onClick={addField}>
                <Plus className="h-3.5 w-3.5" />
                Add Field
              </AppButton>
            </div>
            {fields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm text-slate-500">
                No fields yet. Add a field to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {fields.map((field, i) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    index={i}
                    onChange={(updated) => updateField(i, updated)}
                    onRemove={() => removeField(i)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 border-t pt-4">
            <AppButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </AppButton>
            <AppButton type="submit" disabled={isSubmitting || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create Template'}
            </AppButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<string, string> = {
  CLINIC: 'Clinic-wide',
  DISCIPLINE: 'Discipline',
  SERVICE: 'Service',
}

export default function FormsPage() {
  const queryClient = useQueryClient()
  const toast = useAppToast()
  const { showModal } = useSystemModal()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<FormTemplate | null>(null)

  const {
    data: templates,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['formTemplates'],
    queryFn: listTemplates,
  })

  const disableMutation = useMutation({
    mutationFn: disableTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formTemplates'] })
      toast.success('Template disabled')
    },
    onError: () => toast.error('Failed to disable template'),
  })

  const handleEdit = (template: FormTemplate) => {
    setEditingTemplate(template)
    setDialogOpen(true)
  }

  const handleDisable = (id: string, name: string) => {
    showModal({
      title: 'Disable Template',
      description: `Disable "${name}"? It will no longer be shown to patients but historical responses are preserved.`,
      actionLabel: 'Disable',
      onAction: () => disableMutation.mutate(id),
    })
  }

  const formatDate = (str: string) =>
    new Date(str).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Form Templates"
        description="Manage intake and visit forms shown to patients."
        actions={
          <AppButton
            onClick={() => {
              setEditingTemplate(null)
              setDialogOpen(true)
            }}
            className="rounded-full shadow-md px-6"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </AppButton>
        }
      />

      <AppCard className="border-none shadow-sm overflow-hidden">
        <AppCardHeader className="bg-slate-50/50 border-b-0 py-6 px-8">
          <h2 className="text-lg font-bold text-slate-900">All Templates</h2>
        </AppCardHeader>
        <AppCardContent className="p-0">
          {isLoading && (
            <div className="p-8 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-xl" />
              ))}
            </div>
          )}

          {error && (
            <div className="m-8 rounded-2xl border border-danger/20 bg-danger/5 p-6 text-sm text-danger">
              Failed to load templates. Please try again.
            </div>
          )}

          {!isLoading && !error && (!templates || templates.length === 0) && (
            <div className="p-12">
              <AppEmptyState
                title="No form templates yet"
                description="Create a template to collect patient information before or after appointments."
                actionLabel="New Template"
                onAction={() => {
                  setEditingTemplate(null)
                  setDialogOpen(true)
                }}
              />
            </div>
          )}

          {!isLoading && !error && templates && templates.length > 0 && (
            <AppTable<FormTemplate>
              mobileCardMode
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  mobilePrimary: true,
                  render: (t) => <span className="font-bold text-slate-900">{t.name}</span>,
                },
                {
                  key: 'scope',
                  header: 'Scope',
                  render: (t) => (
                    <div className="flex flex-col gap-1">
                      <AppBadge variant="secondary" className="w-fit">
                        {SCOPE_LABELS[t.scope] ?? t.scope}
                      </AppBadge>
                      {t.discipline && (
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                          {t.discipline.name}
                        </span>
                      )}
                      {t.service && (
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                          {t.service.name}
                        </span>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'fields',
                  header: 'Fields',
                  render: (t) => (
                    <span className="text-slate-600 font-medium">
                      {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
                    </span>
                  ),
                },
                {
                  key: 'created',
                  header: 'Created',
                  render: (t) => (
                    <span className="text-slate-500 text-xs font-medium">
                      {formatDate(t.createdAt)}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  className: 'text-right',
                  render: (t) => (
                    <div className="flex justify-end gap-2 pr-4">
                      <AppButton
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(t)}
                        className="rounded-full font-bold"
                      >
                        Edit
                      </AppButton>
                      <AppButton
                        variant="ghost"
                        size="sm"
                        className="text-danger hover:bg-danger/10 rounded-full font-bold"
                        onClick={() => handleDisable(t.id, t.name)}
                        disabled={disableMutation.isPending}
                      >
                        Disable
                      </AppButton>
                    </div>
                  ),
                },
              ]}
              data={templates}
              keyExtractor={(t) => t.id}
            />
          )}
        </AppCardContent>
      </AppCard>

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditingTemplate(null)
        }}
        editing={editingTemplate}
      />
    </PageContainer>
  )
}
