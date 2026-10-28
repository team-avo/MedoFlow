'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getProvider,
  createAvailability,
  updateAvailability,
  createUnavailability,
  deactivateProvider,
  type ProviderWithAvailability,
  type ProviderAvailabilitySlot,
  type UpdateAvailabilityPayload,
} from '@/lib/availabilityApi'
import { useRouter } from 'next/navigation'
import { ImpactModal } from '@/components/ImpactModal'
import { ProviderServicesCard } from '@/components/providers/ProviderServicesCard'
import { EditProviderDialog } from '@/components/providers/EditProviderDialog'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppButton,
  AppPageHeader,
  AppInput,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { ChevronLeft, UserCog, PowerOff } from 'lucide-react'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MIN_SLOT_MINUTES = 30
const TIME_INPUT_STEP_SECONDS = 30 * 60

function formatDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getTodayDateValue() {
  return formatDateInputValue(new Date())
}

function getDateWeekday(date: string) {
  if (!date) return new Date().getDay()
  return new Date(`${date}T00:00:00`).getDay()
}

function getNextDateForWeekday(weekday: number) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const offset = (weekday - today.getDay() + 7) % 7
  const nextDate = new Date(today)
  nextDate.setDate(today.getDate() + offset)
  return formatDateInputValue(nextDate)
}

function getMinutesBetweenTimes(startTime: string, endTime: string) {
  const [startHours, startMinutes] = startTime.split(':').map(Number)
  const [endHours, endMinutes] = endTime.split(':').map(Number)
  return (endHours ?? 0) * 60 + (endMinutes ?? 0) - ((startHours ?? 0) * 60 + (startMinutes ?? 0))
}

export default function ProviderAvailabilityPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const providerId = params.id as string

  const [toast, setToast] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deactivateConfirm, setDeactivateConfirm] = useState(false)
  const [showUnavailabilityForm, setShowUnavailabilityForm] = useState(false)
  const [impactModal, setImpactModal] = useState<{
    affectedCount: number
    availabilityId: string
    payload: UpdateAvailabilityPayload
  } | null>(null)

  const {
    data: provider,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['provider', providerId],
    queryFn: () => getProvider(providerId),
    enabled: !!providerId,
  })

  const createMutation = useMutation({
    mutationFn: (payload: { weekday: number; startTime: string; endTime: string }) =>
      createAvailability(providerId, payload),
  })

  const unavailabilityMutation = useMutation({
    mutationFn: (payload: {
      date: string
      startTime?: string
      endTime?: string
      reason?: string
    }) => createUnavailability(providerId, payload),
  })

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateProvider(providerId),
  })

  const updateMutation = useMutation({
    mutationFn: ({
      availabilityId,
      payload,
      force,
    }: {
      availabilityId: string
      payload: UpdateAvailabilityPayload
      force?: boolean
    }) => updateAvailability(providerId, availabilityId, payload, { force }),
  })

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(t)
    }
  }, [toast])

  const handleUpdate = async (availabilityId: string, payload: UpdateAvailabilityPayload) => {
    try {
      const result = await updateMutation.mutateAsync({
        availabilityId,
        payload,
      })
      if ('requiresConfirmation' in result && result.requiresConfirmation) {
        setImpactModal({
          affectedCount: result.affectedCount,
          availabilityId,
          payload,
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] })
      setToast('Availability updated successfully.')
    } catch {
      // Error handled by mutation
    }
  }

  const handleAddSlot = async (payload: {
    weekday: number
    startTime: string
    endTime: string
  }) => {
    try {
      await createMutation.mutateAsync(payload)
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] })
      setShowAddForm(false)
      setToast('Availability slot added.')
    } catch {
      // Error handled by mutation
    }
  }

  const handleForceUpdate = async () => {
    if (!impactModal) return
    try {
      await updateMutation.mutateAsync({
        availabilityId: impactModal.availabilityId,
        payload: impactModal.payload,
        force: true,
      })
      setImpactModal(null)
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] })
      setToast('Availability updated successfully.')
    } catch {
      // Error handled by mutation
    }
  }

  if (isLoading || !provider) {
    if (error) {
      return (
        <PageContainer className="space-y-6">
          <Link
            href="/dashboard/providers"
            className="flex items-center gap-1 text-sm font-bold text-accent hover:text-accent/80 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" /> Back to Providers
          </Link>
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-sm font-medium text-destructive">
            Failed to load clinical provider data. Please try again.
          </div>
        </PageContainer>
      )
    }
    return (
      <PageContainer className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-accent" />
      </PageContainer>
    )
  }

  const handleDeactivate = async () => {
    if (!deactivateConfirm) {
      setDeactivateConfirm(true)
      return
    }
    try {
      await deactivateMutation.mutateAsync()
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      router.push('/dashboard/providers')
    } catch {
      setDeactivateConfirm(false)
    }
  }

  return (
    <PageContainer className="space-y-8">
      <div className="space-y-4">
        <Link
          href="/dashboard/providers"
          className="flex items-center gap-1 text-sm font-bold text-accent hover:text-accent/80 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" /> Back to Providers
        </Link>
        <AppPageHeader
          title={`Availability — ${provider.firstName} ${provider.lastName}`}
          description={
            provider.disciplines?.length
              ? provider.disciplines.map((pd) => pd.discipline.name).join(' · ')
              : (provider.discipline?.name ?? 'Clinical Staff')
          }
          actions={
            <div className="flex flex-wrap gap-3">
              <AppButton
                variant="outline"
                size="sm"
                onClick={() => setEditDialogOpen(true)}
                className="rounded-full font-bold"
              >
                <UserCog className="mr-2 h-4 w-4" /> Edit Profile
              </AppButton>
              <AppButton
                variant="outline"
                size="sm"
                className={
                  deactivateConfirm
                    ? 'rounded-full border-rose-500 text-rose-600 bg-rose-50 hover:bg-rose-100 font-bold'
                    : 'rounded-full border-slate-200 text-slate-500 font-bold'
                }
                onClick={handleDeactivate}
                disabled={deactivateMutation.isPending}
              >
                <PowerOff className="mr-2 h-4 w-4" />
                {deactivateConfirm ? 'Confirm Deactivation' : 'Deactivate'}
              </AppButton>
            </div>
          }
        />
      </div>

      <EditProviderDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        provider={provider}
      />

      {toast && (
        <div
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-4 text-sm font-bold text-emerald-800 animate-in fade-in"
          role="status"
        >
          {toast}
        </div>
      )}

      <ProviderServicesCard providerId={providerId} />

      <AppCard>
        <AppCardHeader>
          <AppCardTitle>Recurring Weekly Schedule</AppCardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the default operating hours for this provider. These slots repeat every week.
          </p>
        </AppCardHeader>
        <AppCardContent>
          <div className="space-y-4">
            {provider.providerAvailability?.length ? (
              provider.providerAvailability.map((slot) => (
                <AvailabilityRow
                  key={slot.id}
                  slot={slot}
                  onUpdate={(payload) => handleUpdate(slot.id, payload)}
                  isSubmitting={updateMutation.isPending}
                />
              ))
            ) : (
              <div className="py-8 text-center text-slate-400 font-medium italic border-2 border-dashed border-slate-100 rounded-2xl">
                No active availability slots. Add one to enable booking.
              </div>
            )}

            <div className="pt-4">
              {showAddForm || !provider.providerAvailability?.length ? (
                <AddSlotForm
                  onSubmit={handleAddSlot}
                  onCancel={() => setShowAddForm(false)}
                  showCancel={!!provider.providerAvailability?.length}
                  isSubmitting={createMutation.isPending}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="w-full rounded-2xl border-2 border-dashed border-slate-200 py-4 text-sm font-bold text-slate-500 hover:border-accent hover:text-accent transition-colors"
                >
                  + Add New Weekly Slot
                </button>
              )}
            </div>
          </div>
        </AppCardContent>
      </AppCard>

      <AppCard>
        <AppCardHeader>
          <AppCardTitle>Clinical Time Off</AppCardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Block specific dates or times when the provider is unavailable for consultations.
          </p>
        </AppCardHeader>
        <AppCardContent>
          {showUnavailabilityForm ? (
            <AddUnavailabilityForm
              onSubmit={async (payload: {
                date: string
                startTime?: string
                endTime?: string
                reason?: string
              }) => {
                await unavailabilityMutation.mutateAsync(payload)
                queryClient.invalidateQueries({ queryKey: ['provider', providerId] })
                setShowUnavailabilityForm(false)
                setToast('Time off added.')
              }}
              onCancel={() => setShowUnavailabilityForm(false)}
              isSubmitting={unavailabilityMutation.isPending}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowUnavailabilityForm(true)}
              className="w-full rounded-2xl border-2 border-dashed border-slate-200 py-4 text-sm font-bold text-slate-500 hover:border-accent hover:text-accent transition-colors"
            >
              + Record Time Off
            </button>
          )}
        </AppCardContent>
      </AppCard>

      {impactModal && (
        <ImpactModal
          isOpen={!!impactModal}
          onClose={() => setImpactModal(null)}
          affectedCount={impactModal.affectedCount}
          onForceUpdate={handleForceUpdate}
          onCancel={() => setImpactModal(null)}
          isForceLoading={updateMutation.isPending}
        />
      )}
    </PageContainer>
  )
}

function AddUnavailabilityForm({
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  onSubmit: (payload: {
    date: string
    startTime?: string
    endTime?: string
    reason?: string
  }) => void
  onCancel: () => void
  isSubmitting: boolean
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [reason, setReason] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      date,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      reason: reason.trim() || undefined,
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-6 animate-in"
    >
      <div className="w-full min-w-0 sm:w-36">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          Date
        </label>
        <AppInput
          type="date"
          value={date}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
        />
      </div>
      <div className="w-full min-w-0 sm:w-32">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          Start
        </label>
        <AppInput
          type="time"
          value={startTime}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartTime(e.target.value)}
        />
      </div>
      <div className="w-full min-w-0 sm:w-32">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          End
        </label>
        <AppInput
          type="time"
          value={endTime}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndTime(e.target.value)}
        />
      </div>
      <div className="min-w-0 flex-1 sm:w-40">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          Reason
        </label>
        <AppInput
          type="text"
          value={reason}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
          placeholder="Vacation, conference, etc."
        />
      </div>
      <div className="flex gap-2">
        <AppButton
          type="submit"
          disabled={isSubmitting}
          className="rounded-full font-bold shadow-md"
        >
          {isSubmitting ? 'Adding...' : 'Add Block'}
        </AppButton>
        <AppButton
          type="button"
          variant="outline"
          onClick={onCancel}
          className="rounded-full font-bold"
        >
          Cancel
        </AppButton>
      </div>
    </form>
  )
}

function AddSlotForm({
  onSubmit,
  onCancel,
  showCancel,
  isSubmitting,
}: {
  onSubmit: (payload: { weekday: number; startTime: string; endTime: string }) => void
  onCancel: () => void
  showCancel: boolean
  isSubmitting: boolean
}) {
  const [date, setDate] = useState(getNextDateForWeekday(1))
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const weekday = getDateWeekday(date)
  const isValidWindow = getMinutesBetweenTimes(startTime, endTime) >= MIN_SLOT_MINUTES

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidWindow) return
    onSubmit({ weekday, startTime, endTime })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-6 animate-in"
    >
      <div className="w-full min-w-0 sm:w-44">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          Effective Date
        </label>
        <AppInput
          type="date"
          value={date}
          min={getTodayDateValue()}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
        />
        <p className="mt-2 text-[10px] font-bold text-accent uppercase tracking-tighter italic">
          Recurring every {WEEKDAY_NAMES[weekday]}.
        </p>
      </div>
      <div className="w-full min-w-0 sm:w-32">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          Start Time
        </label>
        <AppInput
          type="time"
          step={TIME_INPUT_STEP_SECONDS}
          value={startTime}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartTime(e.target.value)}
        />
      </div>
      <div className="w-full min-w-0 sm:w-32">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          End Time
        </label>
        <AppInput
          type="time"
          step={TIME_INPUT_STEP_SECONDS}
          value={endTime}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndTime(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <AppButton
          type="submit"
          disabled={isSubmitting || !isValidWindow}
          className="rounded-full font-bold shadow-md px-8"
        >
          {isSubmitting ? 'Adding...' : 'Add Weekly Slot'}
        </AppButton>
        {showCancel && (
          <AppButton
            type="button"
            variant="outline"
            onClick={onCancel}
            className="rounded-full font-bold"
          >
            Cancel
          </AppButton>
        )}
      </div>
    </form>
  )
}

function AvailabilityRow({
  slot,
  onUpdate,
  isSubmitting,
}: {
  slot: ProviderAvailabilitySlot
  onUpdate: (payload: UpdateAvailabilityPayload) => void
  isSubmitting: boolean
}) {
  const [date, setDate] = useState(getNextDateForWeekday(slot.weekday))
  const [startTime, setStartTime] = useState(slot.startTime)
  const [endTime, setEndTime] = useState(slot.endTime)
  const weekday = getDateWeekday(date)
  const isValidWindow = getMinutesBetweenTimes(startTime, endTime) >= MIN_SLOT_MINUTES

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidWindow) return
    onUpdate({
      weekday,
      startTime,
      endTime,
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-6 hover:bg-white hover:shadow-sm transition-colors"
    >
      <div className="w-full min-w-0 sm:w-44">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          Weekday
        </label>
        <AppInput
          type="date"
          value={date}
          min={getTodayDateValue()}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
        />
        <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
          Recurring {WEEKDAY_NAMES[weekday]}
        </p>
      </div>
      <div className="w-full min-w-0 sm:w-32">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          Start Time
        </label>
        <AppInput
          type="time"
          step={TIME_INPUT_STEP_SECONDS}
          value={startTime}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartTime(e.target.value)}
        />
      </div>
      <div className="w-full min-w-0 sm:w-32">
        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">
          End Time
        </label>
        <AppInput
          type="time"
          step={TIME_INPUT_STEP_SECONDS}
          value={endTime}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndTime(e.target.value)}
        />
      </div>
      <AppButton
        type="submit"
        disabled={isSubmitting || !isValidWindow}
        variant="outline"
        className="rounded-full font-bold px-8 h-11"
      >
        {isSubmitting ? 'Updating...' : 'Update Window'}
      </AppButton>
    </form>
  )
}
