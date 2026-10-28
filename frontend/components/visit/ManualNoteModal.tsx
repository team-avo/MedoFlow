'use client'

/**
 * ManualNoteModal — fast-path documentation.
 *
 * The AI Scribe flow (video + audio + transcription) lives at
 * `/dashboard/provider/appointments/[id]/consultation` and is intentionally a
 * full page because it runs for ~30 minutes and needs camera/mic permissions.
 *
 * But sometimes a provider just wants to type the SOAP note and be done with
 * it — no recording, no transcript, no live patient on the other end. That's
 * what this modal is for. It:
 *
 *   1. Creates (or reuses) the VisitRecord for the appointment.
 *   2. Saves the four SOAP fields.
 *   3. Optionally finalises the record so it becomes part of the immutable
 *      clinical audit trail.
 */

import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { AppButton } from '@/components/ui-system'
import { Sparkles, Lock } from 'lucide-react'
import {
  createVisitRecord,
  updateVisitRecord,
  finalizeVisitRecord,
  type VisitRecord,
} from '@/lib/patientApi'
import { useAppToast } from '@/hooks/useAppToast'
import { cn } from '@/lib/utils'

interface ManualNoteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointmentId: string
  patientId: string
  /** Existing visit record if there is one — we'll edit it instead of create. */
  existingVisit?: VisitRecord | null
  /** Fires after save/finalise so the parent can refetch. */
  onSaved?: (visit: VisitRecord) => void
}

type SoapFields = {
  subjective: string
  objective: string
  assessment: string
  plan: string
}

const FIELDS: Array<{
  key: keyof SoapFields
  label: string
  hint: string
  placeholder: string
}> = [
  {
    key: 'subjective',
    label: 'Subjective',
    hint: 'What the patient reports',
    placeholder: 'Chief complaint, history of present illness, patient-reported symptoms…',
  },
  {
    key: 'objective',
    label: 'Objective',
    hint: 'What you observe',
    placeholder: 'Vitals, exam findings, imaging, labs…',
  },
  {
    key: 'assessment',
    label: 'Assessment',
    hint: 'Your clinical impression',
    placeholder: 'Diagnosis, differential, clinical reasoning…',
  },
  {
    key: 'plan',
    label: 'Plan',
    hint: 'What happens next',
    placeholder: 'Treatment, follow-up, referrals, prescriptions, patient education…',
  },
]

export function ManualNoteModal({
  open,
  onOpenChange,
  appointmentId,
  patientId,
  existingVisit,
  onSaved,
}: ManualNoteModalProps) {
  const toast = useAppToast()
  const [values, setValues] = React.useState<SoapFields>({
    subjective: existingVisit?.subjective ?? '',
    objective: existingVisit?.objective ?? '',
    assessment: existingVisit?.assessment ?? '',
    plan: existingVisit?.plan ?? '',
  })
  const [saving, setSaving] = React.useState(false)
  const [activeAction, setActiveAction] = React.useState<'save' | 'finalise' | null>(null)

  // When the modal opens on a different appointment / record, hydrate the
  // form from the canonical record instead of stale local state.
  React.useEffect(() => {
    if (!open) return
    setValues({
      subjective: existingVisit?.subjective ?? '',
      objective: existingVisit?.objective ?? '',
      assessment: existingVisit?.assessment ?? '',
      plan: existingVisit?.plan ?? '',
    })
  }, [open, existingVisit])

  const isFinalized = existingVisit?.isFinalized === true
  const anyFilled = Object.values(values).some((v) => v.trim().length > 0)

  const handleSave = async (finalize: boolean) => {
    setSaving(true)
    setActiveAction(finalize ? 'finalise' : 'save')
    try {
      // Upsert: create if no visit exists, otherwise update.
      const record = existingVisit
        ? await updateVisitRecord(existingVisit.id, values)
        : await createVisitRecord(appointmentId, { patientId, ...values })

      const finalRecord = finalize ? await finalizeVisitRecord(record.id) : record

      toast.success(finalize ? 'Note finalised' : 'Draft saved')
      onSaved?.(finalRecord)
      onOpenChange(false)
    } catch (err) {
      toast.error(
        finalize
          ? 'Could not finalise note. Please try again.'
          : 'Could not save note. Please try again.'
      )
    } finally {
      setSaving(false)
      setActiveAction(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl overflow-hidden rounded-3xl border border-slate-100 p-0 shadow-lg"
        aria-describedby="manual-note-description"
      >
        {/* Header — brand gradient so the modal feels part of the product */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#0F766E] px-6 py-5 text-white">
          <DialogHeader className="relative space-y-2 text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80">
              <Sparkles className="h-3 w-3" />
              Manual SOAP note
            </div>
            <DialogTitle className="text-xl font-bold">
              {isFinalized ? 'Clinical note (finalised)' : 'Document this visit'}
            </DialogTitle>
            <DialogDescription id="manual-note-description" className="text-sm text-white/70">
              Skip the Scribe for a quick text-only record. You can save a draft now and finalise
              later, or finalise straight away to lock the note into the audit trail.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!isFinalized && !saving) void handleSave(false)
          }}
          className="max-h-[65vh] space-y-5 overflow-y-auto px-6 py-6"
        >
          {FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <label
                  htmlFor={`manual-note-${field.key}`}
                  className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-600"
                >
                  {field.label}
                </label>
                <span className="text-[11px] text-slate-400">{field.hint}</span>
              </div>
              <textarea
                id={`manual-note-${field.key}`}
                rows={4}
                value={values[field.key]}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                disabled={saving || isFinalized}
                className={cn(
                  'w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors',
                  'focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#0D9488]/25',
                  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'
                )}
              />
            </div>
          ))}

          {!isFinalized && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-xs text-amber-900">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Finalising locks the note and adds it to the immutable clinical audit trail.
                Amendments are still possible but original text is preserved.
              </p>
            </div>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <AppButton
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="rounded-full"
          >
            Close
          </AppButton>
          {!isFinalized && (
            <>
              <AppButton
                variant="outline"
                onClick={() => handleSave(false)}
                disabled={saving || !anyFilled}
                className="rounded-full border-slate-200"
              >
                {activeAction === 'save' ? 'Saving…' : 'Save draft'}
              </AppButton>
              <AppButton
                onClick={() => handleSave(true)}
                disabled={saving || !anyFilled}
                className="rounded-full bg-gradient-to-r from-[#0D9488] to-[#14B8A6] text-white shadow-md shadow-[#14B8A6]/30 hover:from-[#0F766E] hover:to-[#0D9488]"
              >
                {activeAction === 'finalise' ? 'Finalising…' : 'Save & finalise'}
              </AppButton>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
