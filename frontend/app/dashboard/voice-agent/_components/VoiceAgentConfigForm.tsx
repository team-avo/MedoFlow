'use client'

/**
 * VoiceAgentConfigForm — clinic owner configures the AI receptionist.
 *
 * Sections:
 *   • Status        — enabled toggle
 *   • Personality   — greeting, persona preset, voice
 *   • Capabilities  — book / reschedule / refill / messages / transfer
 *   • Hand-off      — escalation phone, after-hours message
 *   • Advanced      — clinic-specific instructions appended to prompt
 */

import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Check, Loader2 } from 'lucide-react'
import {
  voiceAgentApi,
  type VoiceAgentConfig,
  type VoicePersona,
  type RealtimeVoice,
} from '@/lib/voiceAgentApi'
import { useAppToast } from '@/hooks/useAppToast'

const PERSONAS: Array<{
  id: VoicePersona
  label: string
  blurb: string
}> = [
  { id: 'WARM', label: 'Warm', blurb: 'Friendly, conversational — default' },
  { id: 'PROFESSIONAL', label: 'Professional', blurb: 'Calm, concise — specialists' },
  { id: 'UPBEAT', label: 'Upbeat', blurb: 'Energetic — wellness, aesthetics' },
]

const VOICES: Array<{ id: RealtimeVoice; label: string; note: string }> = [
  { id: 'alloy', label: 'Alloy', note: 'Neutral · default' },
  { id: 'ash', label: 'Ash', note: 'Deeper, calm' },
  { id: 'ballad', label: 'Ballad', note: 'Soft, soothing' },
  { id: 'coral', label: 'Coral', note: 'Bright, friendly' },
  { id: 'echo', label: 'Echo', note: 'Even, clear' },
  { id: 'sage', label: 'Sage', note: 'Steady, measured' },
  { id: 'shimmer', label: 'Shimmer', note: 'Warm, expressive' },
  { id: 'verse', label: 'Verse', note: 'Natural, conversational' },
]

const CAPABILITIES = [
  {
    key: 'book',
    label: 'Book appointments',
    help: 'Look up patients and confirm a new appointment.',
  },
  { key: 'reschedule', label: 'Reschedule', help: 'Move existing appointments.' },
  { key: 'cancel', label: 'Cancel', help: 'Cancel and trigger refund flow if applicable.' },
  {
    key: 'refill',
    label: 'Refill requests',
    help: 'Queue medication refills for provider review.',
  },
  { key: 'messages', label: 'Take messages', help: 'Capture messages with urgency tag.' },
  {
    key: 'transfer',
    label: 'Transfer to human',
    help: 'Forward when caller asks or escalation triggers.',
  },
  { key: 'info', label: 'Answer FAQs', help: 'Hours, location, services, accepted insurance.' },
]

export function VoiceAgentConfigForm() {
  const qc = useQueryClient()
  const toast = useAppToast()

  const { data: config, isLoading } = useQuery({
    queryKey: ['voice-agent', 'config'],
    queryFn: voiceAgentApi.getConfig,
  })

  const [draft, setDraft] = useState<Partial<VoiceAgentConfig> | null>(null)

  useEffect(() => {
    if (config && !draft) setDraft(config)
  }, [config, draft])

  const save = useMutation({
    mutationFn: (patch: Partial<VoiceAgentConfig>) => voiceAgentApi.updateConfig(patch),
    onSuccess: (next) => {
      qc.setQueryData(['voice-agent', 'config'], next)
      setDraft(next)
      toast.success('Voice agent updated')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    },
  })

  if (isLoading || !draft) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-hairline bg-white p-20 shadow-card">
        <Loader2 className="h-5 w-5 animate-spin text-teal" />
      </div>
    )
  }

  const patch = <K extends keyof VoiceAgentConfig>(key: K, value: VoiceAgentConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const patchCapability = (key: string, val: boolean) => {
    setDraft((d) => ({
      ...d,
      capabilities: { ...(d?.capabilities ?? {}), [key]: val },
    }))
  }

  const handleSave = () => {
    if (!draft) return
    save.mutate({
      enabled: draft.enabled,
      greeting: draft.greeting,
      persona: draft.persona,
      voice: draft.voice,
      afterHoursMessage: draft.afterHoursMessage,
      escalationPhone: draft.escalationPhone,
      capabilities: draft.capabilities,
      systemPromptExtra: draft.systemPromptExtra,
    })
  }

  return (
    <div className="space-y-6">
      {/* ─── Status ─────────────────────────────────────────────────── */}
      <Card title="Status" subtitle="Master switch. Phone calls only ring through when enabled.">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[14px] font-medium text-ink">
              {draft.enabled ? 'Voice agent is on' : 'Voice agent is off'}
            </p>
            <p className="mt-1 text-[12px] text-ink-muted">
              {draft.enabled
                ? 'Incoming phone calls (Phase 2) will be answered automatically. Browser testing always works.'
                : 'Browser testing still works regardless. Toggle on once you’ve tested and are ready for live calls.'}
            </p>
          </div>
          <Toggle on={!!draft.enabled} onChange={(v) => patch('enabled', v)} />
        </div>
      </Card>

      {/* ─── Personality ──────────────────────────────────────────── */}
      <Card title="Personality" subtitle="How the agent introduces itself and sounds.">
        <Field label="Greeting" help="What the agent says when picking up.">
          <textarea
            value={draft.greeting ?? ''}
            onChange={(e) => patch('greeting', e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </Field>

        <Field label="Persona">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {PERSONAS.map((p) => {
              const active = draft.persona === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => patch('persona', p.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    active
                      ? 'border-teal bg-teal-wash ring-2 ring-teal/30'
                      : 'border-hairline bg-white hover:border-ink-faint'
                  }`}
                >
                  <p className="text-[13px] font-semibold text-ink">{p.label}</p>
                  <p className="mt-1 text-[11px] text-ink-muted">{p.blurb}</p>
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="Voice">
          <select
            value={draft.voice ?? 'alloy'}
            onChange={(e) => patch('voice', e.target.value as RealtimeVoice)}
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.note}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      {/* ─── Capabilities ─────────────────────────────────────────── */}
      <Card title="Capabilities" subtitle="What the agent is allowed to do during a call.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((c) => {
            const on = (draft.capabilities ?? {})[c.key] ?? true
            return (
              <label
                key={c.key}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                  on
                    ? 'border-teal/30 bg-teal-wash/40'
                    : 'border-hairline bg-white hover:border-ink-faint'
                }`}
              >
                <Checkbox checked={on} onChange={(v) => patchCapability(c.key, v)} />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-ink">{c.label}</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">{c.help}</p>
                </div>
              </label>
            )
          })}
        </div>
      </Card>

      {/* ─── Hand-off ─────────────────────────────────────────────── */}
      <Card title="Hand-off" subtitle="Where to send the call when the agent escalates.">
        <Field
          label="Escalation phone"
          help="Optional — leave blank to route escalations to voicemail."
        >
          <input
            type="tel"
            value={draft.escalationPhone ?? ''}
            placeholder="+1 555 123 4567"
            onChange={(e) => patch('escalationPhone', e.target.value || null)}
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </Field>
        <Field
          label="After-hours message"
          help="What the agent says when called outside business hours."
        >
          <textarea
            value={draft.afterHoursMessage ?? ''}
            onChange={(e) => patch('afterHoursMessage', e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </Field>
      </Card>

      {/* ─── Advanced ─────────────────────────────────────────────── */}
      <Card
        title="Advanced"
        subtitle="Additional clinic-specific instructions appended to the system prompt."
      >
        <Field
          label="Extra instructions"
          help="Useful for unusual workflows, specific phrasing, products you sell, etc."
        >
          <textarea
            value={draft.systemPromptExtra ?? ''}
            onChange={(e) => patch('systemPromptExtra', e.target.value || null)}
            rows={4}
            placeholder="Example: We don't accept new patients without a referral. If asked about cosmetic Botox pricing, quote $12/unit."
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </Field>
      </Card>

      {/* ─── Save bar ─────────────────────────────────────────────── */}
      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-xl border border-hairline bg-white p-3 shadow-card">
        <button
          type="button"
          onClick={handleSave}
          disabled={save.isPending}
          className="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(13,148,136,0.5)] transition-colors hover:bg-teal-hover disabled:opacity-60"
        >
          {save.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : save.isSuccess ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Saved
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Save changes
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────── Local primitives ────────────────────────

function Card({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
      <header className="border-b border-hairline px-6 py-4">
        <h3 className="mf-display text-[16px] text-ink">{title}</h3>
        {subtitle && <p className="mt-1 text-[12px] text-ink-muted">{subtitle}</p>}
      </header>
      <div className="space-y-5 p-6">{children}</div>
    </section>
  )
}

function Field({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-ink-muted">{label}</label>
      {help && <p className="mb-2 text-[11px] text-ink-faint">{help}</p>}
      {!help && <div className="mb-2" />}
      {children}
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        on ? 'bg-teal' : 'bg-hairline'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
        checked ? 'border-teal bg-teal text-white' : 'border-hairline bg-white text-transparent'
      }`}
    >
      <Check className="h-3 w-3" strokeWidth={3} />
    </button>
  )
}
