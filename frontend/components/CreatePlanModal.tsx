'use client'

import React, { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import {
  treatmentPlanFormSchema,
  treatmentPlanCreatePayloadSchema,
  treatmentPlanUpdatePayloadSchema,
  goalSchema,
  LIMITS,
} from '@/lib/schemas/clinicalRecords'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getDisciplines, type Discipline } from '@/lib/disciplineApi'
import { listProviders, type ProviderListItem } from '@/lib/availabilityApi'
import {
  createTreatmentPlan,
  updateTreatmentPlan,
  completeTreatmentPlan,
  type TreatmentPlan,
  type CreateTreatmentPlanPayload,
  type UpdateTreatmentPlanPayload,
} from '@/lib/treatmentPlanApi'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'

// ───────────────────────── Schema ─────────────────────────

// Same limits as the API (F3.2 parity — lib/schemas/clinicalRecords.ts).
const planSchema = treatmentPlanFormSchema

type PlanFormData = z.infer<typeof planSchema>

// ───────────────────────── Props ─────────────────────────

interface CreatePlanModalProps {
  isOpen: boolean
  onClose: () => void
  patientId: string
  providerId: string
  clinicId: string
  onSuccess?: () => void
  /** If supplied, modal switches to edit mode */
  editingPlan?: TreatmentPlan | null
}

// ───────────────────────── Component ─────────────────────────

export function CreatePlanModal({
  isOpen,
  onClose,
  patientId,
  providerId,
  clinicId,
  onSuccess,
  editingPlan,
}: CreatePlanModalProps) {
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [goals, setGoals] = useState<string[]>([])
  const [newGoal, setNewGoal] = useState('')
  const isEditMode = !!editingPlan
  const showProviderPicker = user?.role === 'FRONT_DESK' || user?.role === 'SUPER_ADMIN'

  // Disciplines list
  const { data: disciplines = [] } = useQuery<Discipline[]>({
    queryKey: ['disciplines'],
    queryFn: () => getDisciplines(),
    enabled: isOpen && !!clinicId,
  })

  // Providers list (FRONT_DESK only)
  const { data: providers = [] } = useQuery<ProviderListItem[]>({
    queryKey: ['providers'],
    queryFn: () => listProviders(),
    enabled: isOpen && !!clinicId && showProviderPicker && !isEditMode,
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PlanFormData>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      name: '',
      disciplineId: '',
      providerId: '',
      totalSessions: 1,
      sessionsCompleted: 0,
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
      notes: '',
    },
  })

  // Populate form and goals when editing
  useEffect(() => {
    if (isOpen && editingPlan) {
      reset({
        name: editingPlan.name,
        disciplineId: editingPlan.disciplineId,
        providerId: editingPlan.providerId,
        totalSessions: editingPlan.totalSessions,
        sessionsCompleted: editingPlan.sessionsCompleted,
        startDate: editingPlan.startDate.split('T')[0],
        endDate: editingPlan.endDate ? editingPlan.endDate.split('T')[0] : '',
        notes: editingPlan.notes ?? '',
      })
      const g = editingPlan.goals
      setGoals(
        Array.isArray(g)
          ? (g as string[]).filter(Boolean)
          : typeof g === 'string'
            ? (() => {
                try {
                  const parsed = JSON.parse(g)
                  return Array.isArray(parsed) ? parsed.filter(Boolean) : []
                } catch {
                  return g ? [g] : []
                }
              })()
            : []
      )
    } else if (isOpen) {
      reset({
        name: '',
        disciplineId: '',
        providerId: providerId || '',
        totalSessions: 1,
        sessionsCompleted: 0,
        startDate: new Date().toISOString().split('T')[0],
        endDate: '',
        notes: '',
      })
      setGoals([])
    }
  }, [isOpen, editingPlan, reset, providerId])

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (payload: CreateTreatmentPlanPayload) => createTreatmentPlan(payload),
    onSuccess: () => {
      reset()
      setGoals([])
      setError(null)
      onSuccess?.()
      onClose()
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Failed to create treatment plan.')
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (payload: UpdateTreatmentPlanPayload) =>
      updateTreatmentPlan(editingPlan!.id, payload),
    onSuccess: () => {
      reset()
      setError(null)
      onSuccess?.()
      onClose()
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Failed to update treatment plan.')
    },
  })

  // Complete mutation (auto-trigger when sessionsCompleted >= totalSessions)
  const completeMutation = useMutation({
    mutationFn: () => completeTreatmentPlan(editingPlan!.id),
    onSuccess: () => {
      reset()
      setError(null)
      onSuccess?.()
      onClose()
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Failed to complete treatment plan.')
    },
  })

  if (!isOpen) return null

  const isPending =
    createMutation.isPending || updateMutation.isPending || completeMutation.isPending

  const handleClose = () => {
    setError(null)
    setGoals([])
    setNewGoal('')
    reset()
    onClose()
  }

  const onSubmit = (formData: PlanFormData) => {
    const goalsPayload = goals.length > 0 ? goals : null
    const resolvedProviderId = showProviderPicker
      ? formData.providerId
      : formData.providerId || providerId

    if (!isEditMode && showProviderPicker && !resolvedProviderId) {
      setError('Please select a provider to assign this plan to.')
      return
    }

    if (isEditMode) {
      const sessionsCompleted = formData.sessionsCompleted ?? editingPlan!.sessionsCompleted
      const totalSessions = formData.totalSessions ?? editingPlan!.totalSessions

      if (sessionsCompleted >= totalSessions) {
        completeMutation.mutate()
        return
      }

      const update: UpdateTreatmentPlanPayload = {
        name: formData.name,
        totalSessions: formData.totalSessions,
        sessionsCompleted,
        startDate: formData.startDate,
        endDate: formData.endDate || null,
        goals: goalsPayload,
        notes: formData.notes || null,
      }
      // Final gate: exactly the rules the API applies (F3.2 parity).
      const checked = treatmentPlanUpdatePayloadSchema.safeParse(update)
      if (!checked.success) {
        setError(checked.error.issues[0]?.message ?? 'Please check the plan details.')
        return
      }
      updateMutation.mutate(update)
    } else {
      const payload: CreateTreatmentPlanPayload = {
        patientId,
        disciplineId: formData.disciplineId,
        name: formData.name,
        totalSessions: formData.totalSessions,
        startDate: formData.startDate,
        endDate: formData.endDate || null,
        goals: goalsPayload,
        notes: formData.notes || null,
      }
      if (resolvedProviderId) payload.providerId = resolvedProviderId
      const checked = treatmentPlanCreatePayloadSchema.safeParse(payload)
      if (!checked.success) {
        setError(checked.error.issues[0]?.message ?? 'Please check the plan details.')
        return
      }
      createMutation.mutate(payload)
    }
  }

  const addGoal = () => {
    if (!newGoal.trim()) return
    const parsed = goalSchema.safeParse(newGoal)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid goal')
      return
    }
    if (goals.length >= LIMITS.goalsMax) {
      setError(`At most ${LIMITS.goalsMax} goals`)
      return
    }
    setError(null)
    setGoals((prev) => [...prev, parsed.data])
    setNewGoal('')
  }

  const removeGoal = (index: number) => {
    setGoals((prev) => prev.filter((_, i) => i !== index))
  }

  // ───────────────── Label helper ─────────────────

  const labelCls = 'block text-sm font-medium text-gray-700'
  const inputCls =
    'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition'
  const errorCls = 'mt-1 text-sm text-red-600'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditMode ? 'Update Treatment Plan' : 'Create Treatment Plan'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </CardHeader>

        <CardContent className="pt-4">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className={labelCls}>Plan Name</label>
              <input
                {...register('name')}
                className={inputCls}
                placeholder="e.g. Low Back Pain Rehab"
              />
              {errors.name && <p className={errorCls}>{errors.name.message}</p>}
            </div>

            {/* Provider (FRONT_DESK create only) */}
            {showProviderPicker && !isEditMode && (
              <div>
                <label className={labelCls}>Assign to Provider</label>
                <select
                  {...register('providerId', {
                    required: showProviderPicker && !isEditMode ? 'Provider is required' : false,
                  })}
                  className={inputCls}
                >
                  <option value="">Select provider</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} (
                      {p.disciplines?.length
                        ? p.disciplines.map((pd) => pd.discipline.name).join(' · ')
                        : (p.discipline?.name ?? '')}
                      )
                    </option>
                  ))}
                </select>
                {errors.providerId && <p className={errorCls}>{errors.providerId.message}</p>}
              </div>
            )}

            {/* Discipline */}
            <div>
              <label className={labelCls}>Discipline</label>
              <select {...register('disciplineId')} className={inputCls} disabled={isEditMode}>
                <option value="">Select discipline</option>
                {disciplines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {errors.disciplineId && <p className={errorCls}>{errors.disciplineId.message}</p>}
            </div>

            {/* Total Sessions */}
            <div>
              <label className={labelCls}>Total Sessions</label>
              <input {...register('totalSessions')} type="number" min={1} className={inputCls} />
              {errors.totalSessions && <p className={errorCls}>{errors.totalSessions.message}</p>}
            </div>

            {/* Sessions Completed (edit only) — auto-complete when >= total */}
            {isEditMode && (
              <div>
                <label className={labelCls}>Sessions Completed</label>
                <input
                  {...register('sessionsCompleted')}
                  type="number"
                  min={0}
                  max={editingPlan?.totalSessions ?? 999}
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-500">
                  When sessions completed equals total, saving will mark the plan as complete.
                </p>
                {errors.sessionsCompleted && (
                  <p className={errorCls}>{errors.sessionsCompleted.message}</p>
                )}
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Start Date</label>
                <input {...register('startDate')} type="date" className={inputCls} />
                {errors.startDate && <p className={errorCls}>{errors.startDate.message}</p>}
              </div>
              <div>
                <label className={labelCls}>End Date (optional)</label>
                <input {...register('endDate')} type="date" className={inputCls} />
              </div>
            </div>

            {/* Goals — Add Goal (string[]) */}
            <div>
              <label className={labelCls}>Goals</label>
              <div className="space-y-2">
                {goals.map((goal, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                  >
                    <span className="flex-1 text-sm text-gray-800">{goal}</span>
                    <button
                      type="button"
                      onClick={() => removeGoal(i)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-red-600"
                      aria-label="Remove goal"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newGoal}
                    onChange={(e) => setNewGoal(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addGoal())}
                    placeholder="e.g. Reduce pain by 50%"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={addGoal}
                    className="shrink-0 rounded-lg border border-primary-600 bg-white px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50"
                  >
                    Add Goal
                  </button>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className={labelCls}>Notes</label>
              <textarea
                {...register('notes')}
                rows={2}
                className={inputCls}
                placeholder="Additional notes…"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Saving…
                  </>
                ) : isEditMode ? (
                  'Update Plan'
                ) : (
                  'Create Plan'
                )}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
