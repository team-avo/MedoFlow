'use client'

import React, { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  getPlansByPatient,
  completeTreatmentPlan,
  discontinueTreatmentPlan,
  type TreatmentPlan,
} from '@/lib/treatmentPlanApi'
import { getDisciplines } from '@/lib/disciplineApi'
import { AppCard, AppCardContent, AppPageHeader, AppButton } from '@/components/ui-system'
import { StatusBadge } from '@/components/common/StatusBadge'
import { CreatePlanModal } from '@/components/CreatePlanModal'

// ───────────────────── helpers ─────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ────────────── Progress bar component ──────────────

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
        <span>
          {completed} / {total} sessions
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-primary-500 transition-colors"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ────────────── Skeleton loader ──────────────

function CardSkeleton() {
  return (
    <AppCard className="animate-pulse">
      <AppCardContent className="space-y-4">
        <div className="h-5 w-3/5 rounded bg-gray-200" />
        <div className="h-4 w-2/5 rounded bg-gray-200" />
        <div className="h-2 w-full rounded bg-gray-200" />
        <div className="flex gap-4">
          <div className="h-4 w-3/5 rounded bg-gray-200" />
          <div className="h-4 w-2/5 rounded bg-gray-200" />
        </div>
      </AppCardContent>
    </AppCard>
  )
}

// ────────────── Plan card ──────────────

function PlanCard({
  plan,
  onEdit,
  onComplete,
  onDiscontinue,
  isActioning,
}: {
  plan: TreatmentPlan
  onEdit: () => void
  onComplete: () => void
  onDiscontinue: () => void
  isActioning: boolean
}) {
  const isActive = plan.status === 'ACTIVE'

  return (
    <AppCard className="group relative overflow-hidden">
      {/* colour accent bar */}
      <div
        className={`absolute left-0 top-0 h-full w-1 ${
          plan.status === 'ACTIVE'
            ? 'bg-blue-600'
            : plan.status === 'COMPLETED'
              ? 'bg-emerald-600'
              : 'bg-slate-400'
        }`}
      />

      <AppCardContent className="pl-6 pt-6 pb-6 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-slate-900">{plan.name}</h3>
            <p className="text-sm font-medium text-slate-400 uppercase tracking-tighter">
              {plan.discipline.name}
            </p>
          </div>
          <StatusBadge status={plan.status} variant="treatmentPlan" className="shrink-0" />
        </div>

        {/* Progress */}
        <ProgressBar completed={plan.sessionsCompleted} total={plan.totalSessions} />

        {/* Dates & Provider */}
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 font-medium">
            <span>
              <span className="text-slate-400 uppercase tracking-tighter">Start:</span>{' '}
              {formatDate(plan.startDate)}
            </span>
            <span>
              <span className="text-slate-400 uppercase tracking-tighter">End:</span>{' '}
              {formatDate(plan.endDate)}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-medium">
            Managed by: {plan.provider.firstName} {plan.provider.lastName}
          </p>
        </div>

        {/* Actions — only for ACTIVE plans */}
        {isActive && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-5">
            <AppButton
              variant="outline"
              size="sm"
              onClick={onEdit}
              disabled={isActioning}
              className="rounded-full font-bold"
            >
              Update
            </AppButton>
            <AppButton
              variant="default"
              size="sm"
              onClick={onComplete}
              disabled={isActioning}
              className="rounded-full bg-emerald-600 hover:bg-emerald-700 font-bold"
            >
              Complete
            </AppButton>
            <AppButton
              variant="ghost"
              size="sm"
              onClick={onDiscontinue}
              disabled={isActioning}
              className="rounded-full text-slate-500 font-bold"
            >
              Discontinue
            </AppButton>
          </div>
        )}
      </AppCardContent>
    </AppCard>
  )
}

// ───────────────────── Page ─────────────────────

type TabKey = 'active' | 'closed'

export default function ProviderPatientPlansPage() {
  const params = useParams()
  const patientId = params.patientId as string
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const clinicId = user?.clinicId ?? ''

  // ── state ──
  const [activeTab, setActiveTab] = useState<TabKey>('active')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<TreatmentPlan | null>(null)

  // ── queries ──
  const {
    data: plans = [],
    isLoading,
    isError,
    error,
  } = useQuery<TreatmentPlan[]>({
    queryKey: ['treatmentPlans', patientId],
    queryFn: () => getPlansByPatient(patientId),
    enabled: !!patientId,
  })

  // ── mutations ──
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['treatmentPlans', patientId] })

  const completeMut = useMutation({
    mutationFn: completeTreatmentPlan,
    onSuccess: invalidate,
  })

  const discontinueMut = useMutation({
    mutationFn: discontinueTreatmentPlan,
    onSuccess: invalidate,
  })

  const isActioning = completeMut.isPending || discontinueMut.isPending

  // ── derived ──
  const activePlans = plans.filter((p) => p.status === 'ACTIVE')
  const closedPlans = plans.filter((p) => p.status === 'COMPLETED' || p.status === 'DISCONTINUED')
  const displayedPlans = activeTab === 'active' ? activePlans : closedPlans

  // providerId: from existing plan, or "" (backend resolves from auth for PROVIDER)
  const providerId = plans[0]?.providerId ?? ''

  // ── handlers ──
  const openCreate = () => {
    setEditingPlan(null)
    setModalOpen(true)
  }
  const openEdit = (plan: TreatmentPlan) => {
    setEditingPlan(plan)
    setModalOpen(true)
  }

  // ────────────── Render ──────────────

  return (
    <div className="space-y-8">
      <AppPageHeader
        title="Treatment Plans"
        description="Manage clinical treatment protocols and session tracking for this patient."
        actions={
          <AppButton type="button" onClick={openCreate} className="rounded-full px-6 shadow-md">
            New Protocol
          </AppButton>
        }
      />

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
        {(
          [
            { key: 'active' as TabKey, label: 'Active', count: activePlans.length },
            { key: 'closed' as TabKey, label: 'Closed', count: closedPlans.length },
          ] as const
        ).map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-6 py-2 rounded-xl text-sm font-bold tracking-tight transition-colors ${
              activeTab === key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {label}
            <span
              className={`ml-2 inline-flex items-center justify-center rounded-full h-5 min-w-[20px] px-1.5 text-[10px] font-black tracking-tighter ${
                activeTab === key
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <p className="text-sm font-medium text-destructive">
            {(error as { message?: string })?.message ?? 'Failed to load treatment plans.'}
          </p>
          <AppButton
            variant="outline"
            size="sm"
            onClick={() =>
              queryClient.invalidateQueries({
                queryKey: ['treatmentPlans', patientId],
              })
            }
            className="mt-4 rounded-full"
          >
            Retry
          </AppButton>
        </div>
      ) : displayedPlans.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-slate-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          <p className="mt-4 text-sm font-bold text-slate-400">
            {activeTab === 'active'
              ? 'No active protocols found.'
              : 'No completed or discontinued plans.'}
          </p>
          {activeTab === 'active' && (
            <AppButton onClick={openCreate} className="mt-6 rounded-full">
              Create first protocol
            </AppButton>
          )}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {displayedPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onEdit={() => openEdit(plan)}
              onComplete={() => completeMut.mutate(plan.id)}
              onDiscontinue={() => discontinueMut.mutate(plan.id)}
              isActioning={isActioning}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      <CreatePlanModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setEditingPlan(null)
        }}
        patientId={patientId}
        providerId={providerId}
        clinicId={clinicId}
        editingPlan={editingPlan}
        onSuccess={invalidate}
      />
    </div>
  )
}
