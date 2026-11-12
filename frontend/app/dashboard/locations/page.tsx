'use client'

/**
 * Locations & hours (CTO-34). Every place the clinic sees patients: add, edit
 * and remove locations, each with its own US address (CTO-22) and timezone.
 * Provider hours are set per provider (Team page), per location; this page
 * is where the places themselves live.
 */
import React from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import { apiErrorOf } from '@/lib/apiError'
import { useAppToast } from '@/hooks/useAppToast'
import { AppButton, AppEmptyState, AppInput, AppPageHeader } from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { US_TIMEZONES, DEFAULT_US_TIMEZONE } from '@/lib/constants/timezones'
import { US_STATES, US_STATE_CODES, US_ZIP, zipStateMismatch } from '@/lib/practiceIds'

interface ClinicLocation {
  id: string
  name: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  phone: string | null
  timezone: string
}

const ONLINE = ['online', 'virtual']

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || US_STATE_CODES.includes(v.toUpperCase()), 'Choose a US state'),
  postalCode: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || US_ZIP.test(v), 'Enter a 5-digit ZIP or ZIP+4'),
  phone: z.string().trim().optional(),
  timezone: z.string().min(1, 'Choose a timezone'),
})
type FormValues = z.infer<typeof schema>

const selectClass =
  'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30'

const blankToUndefined = (v: FormValues) =>
  Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? undefined : x]))

function LocationForm({
  initial,
  onSubmit,
  submitting,
  onCancel,
}: {
  initial?: ClinicLocation | null
  onSubmit: (v: FormValues) => void
  submitting: boolean
  onCancel: () => void
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      addressLine1: initial?.addressLine1 ?? '',
      addressLine2: initial?.addressLine2 ?? '',
      city: initial?.city ?? '',
      state: initial?.state ?? '',
      postalCode: initial?.postalCode ?? '',
      phone: initial?.phone ?? '',
      timezone: initial?.timezone ?? DEFAULT_US_TIMEZONE,
    },
  })
  const zipWarning = zipStateMismatch(watch('postalCode'), watch('state'))
  const field = (id: keyof FormValues, label: string, el: React.ReactNode) => (
    <div className="space-y-1">
      <label htmlFor={`loc-${id}`} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {el}
      {errors[id] && <p className="text-xs text-rose-600">{errors[id]?.message}</p>}
    </div>
  )
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {field(
        'name',
        'Name',
        <AppInput id="loc-name" placeholder="Main clinic" {...register('name')} />
      )}
      {field(
        'addressLine1',
        'Street address',
        <AppInput id="loc-addressLine1" {...register('addressLine1')} />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {field('city', 'City', <AppInput id="loc-city" {...register('city')} />)}
        {field(
          'state',
          'State',
          <select id="loc-state" className={selectClass} {...register('state')}>
            <option value="">Choose…</option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        )}
        {field(
          'postalCode',
          'ZIP',
          <AppInput id="loc-postalCode" inputMode="numeric" {...register('postalCode')} />
        )}
      </div>
      {zipWarning && (
        <p className="text-xs text-amber-700">
          This ZIP is usually outside {watch('state')}. Check the address; you can still save it.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('phone', 'Phone', <AppInput id="loc-phone" type="tel" {...register('phone')} />)}
        {field(
          'timezone',
          'Timezone',
          <select id="loc-timezone" className={selectClass} {...register('timezone')}>
            {US_TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <DialogFooter>
        <AppButton type="button" variant="outline" onClick={onCancel}>
          Cancel
        </AppButton>
        <AppButton type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save location'}
        </AppButton>
      </DialogFooter>
    </form>
  )
}

export default function LocationsPage() {
  const toast = useAppToast()
  const qc = useQueryClient()
  const [editing, setEditing] = React.useState<ClinicLocation | 'new' | null>(null)
  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: async () =>
      (await api.get<{ data?: { locations?: ClinicLocation[] } }>('/locations')).data.data
        ?.locations ?? [],
  })
  const places = locations.filter((l) => !ONLINE.includes(l.name.trim().toLowerCase()))
  const refresh = () => qc.invalidateQueries({ queryKey: ['locations'] })

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const body = blankToUndefined(v)
      if (editing && editing !== 'new') await api.patch(`/locations/${editing.id}`, body)
      else await api.post('/locations', body)
    },
    onSuccess: () => {
      toast.success(editing === 'new' ? 'Location added' : 'Location saved')
      setEditing(null)
      void refresh()
    },
    onError: (err) => toast.error(apiErrorOf(err).message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/locations/${id}`),
    onSuccess: () => {
      toast.success('Location removed')
      void refresh()
    },
    onError: (err) => toast.error(apiErrorOf(err).message),
  })

  return (
    <PageContainer className="space-y-6">
      <AppPageHeader
        title="Locations & hours"
        description="Every place you see patients. Each location keeps its own address and timezone; set each practitioner's hours per location from the Team page."
        actions={
          <AppButton onClick={() => setEditing('new')} className="rounded-full">
            <Plus className="mr-2 h-4 w-4" /> Add location
          </AppButton>
        }
      />

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading locations…</p>
      ) : places.length === 0 ? (
        <AppEmptyState
          title="No locations yet"
          description="Add the place where you see patients."
          icon={<MapPin className="h-6 w-6" />}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="location-list">
          {places.map((l) => (
            <li key={l.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{l.name}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {[l.addressLine1, l.city, l.state, l.postalCode].filter(Boolean).join(', ') ||
                      'No address yet'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {US_TIMEZONES.find((t) => t.value === l.timezone)?.label ?? l.timezone}
                  </p>
                </div>
                <div className="flex gap-1">
                  <AppButton
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${l.name}`}
                    onClick={() => setEditing(l)}
                  >
                    <Pencil className="h-4 w-4" />
                  </AppButton>
                  <AppButton
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${l.name}`}
                    disabled={places.length <= 1 || remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Remove ${l.name}? Past visits keep it on record.`))
                        remove.mutate(l.id)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </AppButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-500">
        Practitioners work at the locations ticked on their profile; set their hours per location on
        the{' '}
        <Link href="/dashboard/staff" className="font-semibold text-brand">
          Team
        </Link>{' '}
        page.
      </p>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Add a location' : 'Edit location'}</DialogTitle>
            <DialogDescription>
              US addresses. The timezone sets when its hours are shown.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <LocationForm
              initial={editing === 'new' ? null : editing}
              onSubmit={(v) => save.mutate(v)}
              submitting={save.isPending}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
