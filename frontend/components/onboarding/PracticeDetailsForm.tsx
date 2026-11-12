'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { AppFormField, AppInput } from '@/components/ui-system'
import { apiErrorOf } from '@/lib/apiError'
import { onboardingApi, type Application } from '@/lib/onboardingApi'
import {
  closestPracticeType,
  isValidDea,
  isValidEin,
  isValidNpi,
  PRACTICE_TYPES,
  US_STATES,
  zipStateMismatch,
} from '@/lib/practiceIds'
import {
  practiceFormDefaults,
  practiceFormSchema,
  toPracticePayload,
  type PracticeFormValues,
} from '@/lib/schemas/onboarding'
import { FormSection, IdCheck, selectClass, TIMEZONES } from './ApplicationShell'
import { NpiRegistryCheck } from './NpiRegistryCheck'
import { useAuth } from '@/contexts/AuthContext'
import { clearDraft, draftKey, loadDraft, PRACTICE_DRAFT_OMIT, saveDraft } from '@/lib/formDraft'

/**
 * Practice details: the first step of the clinic application, and the
 * "Practice" tab of /dashboard/clinic. Field set: legal name / DBA, practice
 * type (or a typed "Other", CTO-18), locations, primary address (written to
 * the main location), a primary and an optional secondary contact (CTO-17),
 * mailing address, regulatory IDs (group NPI or "no NPI", EIN, state license,
 * DEA) and account details.
 */
export function PracticeDetailsForm({
  application,
  owner,
  submitLabel = 'Save & continue',
  onSaved,
}: {
  application: Application | null
  owner?: { name?: string; email?: string }
  submitLabel?: string
  onSaved: (app: Application) => void | Promise<void>
}) {
  const [serverError, setServerError] = React.useState<string | null>(null)
  const { user } = useAuth()
  // CTO-13: an unsent draft survives a refresh (tax ID and DEA never stored).
  const storageKey = draftKey('practice', user?.id)
  const [restored] = React.useState(() => loadDraft<PracticeFormValues>(storageKey))
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PracticeFormValues>({
    resolver: zodResolver(practiceFormSchema),
    defaultValues: { ...practiceFormDefaults(application, owner), ...(restored ?? {}) },
  })
  React.useEffect(() => {
    const sub = watch((values) =>
      saveDraft(storageKey, values as Record<string, unknown>, PRACTICE_DRAFT_OMIT)
    )
    return () => sub.unsubscribe()
  }, [watch, storageKey])

  const v = watch()
  const err = (k: keyof PracticeFormValues) => errors[k]?.message as string | undefined
  // CTO-18: a typed "Other" that closely matches a listed type is offered first.
  const suggestedKey =
    v.practiceType === 'OTHER' ? closestPracticeType(String(v.practiceTypeOther ?? '')) : null
  const suggestion = suggestedKey
    ? { key: suggestedKey, label: PRACTICE_TYPES.find(([k]) => k === suggestedKey)?.[1] ?? '' }
    : null
  // CTO-22: a ZIP outside the chosen state is a warning, never a block.
  const zipWarning = zipStateMismatch(v.postalCode, v.state)
  const mailingZipWarning =
    !v.mailingSameAsPrimary && zipStateMismatch(v.mailingPostalCode, v.mailingState)

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      const app = await onboardingApi.savePractice(toPracticePayload(values))
      clearDraft(storageKey)
      await onSaved(app)
    } catch (e) {
      setServerError(apiErrorOf(e).message)
    }
  })

  const masked = application?.profile?.federalTaxIdMasked
  const deaMasked = application?.profile?.deaNumberMasked

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8" aria-label="Practice details">
      {restored && (
        <p
          role="status"
          className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
          data-testid="draft-restored"
        >
          We restored what you had typed. Your tax ID and DEA number are never kept in this browser,
          so re-enter them if needed.
        </p>
      )}
      <FormSection title="Medical office information">
        <AppFormField
          label="Legal name of practice"
          required
          error={err('legalName')}
          htmlFor="legalName"
          className="md:col-span-2"
        >
          <AppInput
            id="legalName"
            placeholder="Sunrise Wellness Partners LLC"
            {...register('legalName')}
          />
        </AppFormField>
        <div className="space-y-2 md:col-span-2">
          <span className="block text-sm font-medium text-slate-700">Practice name / DBA</span>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={v.sameAsLegal}
                onChange={() => setValue('sameAsLegal', true, { shouldValidate: true })}
              />
              Same as legal name
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={!v.sameAsLegal}
                onChange={() => setValue('sameAsLegal', false, { shouldValidate: true })}
              />
              Other
            </label>
          </div>
          {!v.sameAsLegal && (
            <AppFormField
              label="Doing business as"
              required
              error={err('dbaName')}
              htmlFor="dbaName"
            >
              <AppInput id="dbaName" placeholder="Sunrise Family Clinic" {...register('dbaName')} />
            </AppFormField>
          )}
        </div>
        <AppFormField
          label="Practice type"
          required
          error={err('practiceType')}
          htmlFor="practiceType"
        >
          <select id="practiceType" className={selectClass} {...register('practiceType')}>
            <option value="">Choose…</option>
            {PRACTICE_TYPES.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </AppFormField>
        {v.practiceType === 'OTHER' && (
          <AppFormField
            label="Your practice type"
            required
            error={err('practiceTypeOther')}
            htmlFor="practiceTypeOther"
          >
            <AppInput
              id="practiceTypeOther"
              maxLength={80}
              placeholder="e.g. Peptide clinic"
              {...register('practiceTypeOther')}
            />
            {suggestion && (
              <p className="text-xs text-slate-600" data-testid="practice-type-suggestion">
                Did you mean <strong>{suggestion.label}</strong>?{' '}
                <button
                  type="button"
                  className="font-semibold text-brand underline"
                  onClick={() => {
                    setValue('practiceType', suggestion.key, { shouldValidate: true })
                    setValue('practiceTypeOther', '')
                  }}
                >
                  Use it
                </button>
              </p>
            )}
          </AppFormField>
        )}
        <AppFormField
          label="Number of locations"
          required
          error={err('locationCount')}
          htmlFor="locationCount"
        >
          <AppInput
            id="locationCount"
            type="number"
            min={1}
            max={500}
            {...register('locationCount', { valueAsNumber: true })}
          />
        </AppFormField>
      </FormSection>

      <FormSection
        title="Primary location"
        description="Your main office. Booking, reminders and your website use this address and timezone."
      >
        <AppFormField
          label="Primary street address"
          required
          error={err('addressLine1')}
          htmlFor="addressLine1"
          className="md:col-span-2"
        >
          <AppInput id="addressLine1" placeholder="100 Main Street" {...register('addressLine1')} />
        </AppFormField>
        <AppFormField label="Apt, suite, etc." error={err('addressLine2')} htmlFor="addressLine2">
          <AppInput id="addressLine2" placeholder="Suite 200" {...register('addressLine2')} />
        </AppFormField>
        <AppFormField label="City" required error={err('city')} htmlFor="city">
          <AppInput id="city" {...register('city')} />
        </AppFormField>
        <AppFormField label="State" required error={err('state')} htmlFor="state">
          <select id="state" className={selectClass} {...register('state')}>
            <option value="">Choose…</option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </AppFormField>
        <AppFormField label="ZIP" required error={err('postalCode')} htmlFor="postalCode">
          <AppInput
            id="postalCode"
            inputMode="numeric"
            placeholder="75001"
            {...register('postalCode')}
          />
          {zipWarning && !err('postalCode') && (
            <p className="text-xs text-amber-700" data-testid="zip-warning">
              This ZIP is usually outside {v.state}. Check the address; you can still save it.
            </p>
          )}
        </AppFormField>
        <AppFormField label="Timezone" required error={err('timezone')} htmlFor="timezone">
          <select id="timezone" className={selectClass} {...register('timezone')}>
            {TIMEZONES.map(([tz, label]) => (
              <option key={tz} value={tz}>
                {label}
              </option>
            ))}
          </select>
        </AppFormField>
        <AppFormField label="Office phone" error={err('officePhone')} htmlFor="officePhone">
          <AppInput
            id="officePhone"
            type="tel"
            placeholder="(555) 010-0100"
            {...register('officePhone')}
          />
        </AppFormField>
        <AppFormField label="Fax" error={err('fax')} htmlFor="fax">
          <AppInput id="fax" type="tel" {...register('fax')} />
        </AppFormField>
        <AppFormField label="Website" error={err('website')} htmlFor="website">
          <AppInput id="website" placeholder="www.yourpractice.com" {...register('website')} />
        </AppFormField>
      </FormSection>

      <FormSection title="Contacts" description="Who we contact about your account.">
        <AppFormField
          label="Primary contact name"
          required
          error={err('primaryContactName')}
          htmlFor="primaryContactName"
        >
          <AppInput id="primaryContactName" {...register('primaryContactName')} />
        </AppFormField>
        <AppFormField
          label="Primary contact email"
          required
          error={err('primaryContactEmail')}
          htmlFor="primaryContactEmail"
        >
          <AppInput id="primaryContactEmail" type="email" {...register('primaryContactEmail')} />
        </AppFormField>
        <AppFormField
          label="Primary contact phone"
          error={err('primaryContactPhone')}
          htmlFor="primaryContactPhone"
        >
          <AppInput id="primaryContactPhone" type="tel" {...register('primaryContactPhone')} />
        </AppFormField>
        <div className="hidden md:block" />
        <AppFormField
          label="Secondary contact name (optional)"
          error={err('secondaryContactName')}
          htmlFor="secondaryContactName"
        >
          <AppInput id="secondaryContactName" {...register('secondaryContactName')} />
        </AppFormField>
        <AppFormField
          label="Secondary contact email"
          error={err('secondaryContactEmail')}
          htmlFor="secondaryContactEmail"
        >
          <AppInput
            id="secondaryContactEmail"
            type="email"
            {...register('secondaryContactEmail')}
          />
        </AppFormField>
        <AppFormField
          label="Secondary contact phone"
          error={err('secondaryContactPhone')}
          htmlFor="secondaryContactPhone"
        >
          <AppInput id="secondaryContactPhone" type="tel" {...register('secondaryContactPhone')} />
        </AppFormField>
      </FormSection>

      <FormSection title="Mailing / billing address">
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
          <input type="checkbox" {...register('mailingSameAsPrimary')} />
          Same as the primary location
        </label>
        {!v.mailingSameAsPrimary && (
          <>
            <AppFormField
              label="Street address"
              required
              error={err('mailingAddressLine1')}
              htmlFor="mailingAddressLine1"
              className="md:col-span-2"
            >
              <AppInput id="mailingAddressLine1" {...register('mailingAddressLine1')} />
            </AppFormField>
            <AppFormField
              label="Apt, suite, etc."
              error={err('mailingAddressLine2')}
              htmlFor="mailingAddressLine2"
            >
              <AppInput id="mailingAddressLine2" {...register('mailingAddressLine2')} />
            </AppFormField>
            <AppFormField label="City" required error={err('mailingCity')} htmlFor="mailingCity">
              <AppInput id="mailingCity" {...register('mailingCity')} />
            </AppFormField>
            <AppFormField label="State" required error={err('mailingState')} htmlFor="mailingState">
              <select id="mailingState" className={selectClass} {...register('mailingState')}>
                <option value="">Choose…</option>
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </AppFormField>
            <AppFormField
              label="ZIP"
              required
              error={err('mailingPostalCode')}
              htmlFor="mailingPostalCode"
            >
              <AppInput
                id="mailingPostalCode"
                inputMode="numeric"
                {...register('mailingPostalCode')}
              />
              {mailingZipWarning && !err('mailingPostalCode') && (
                <p className="text-xs text-amber-700">
                  This ZIP is usually outside {v.mailingState}. Check the address; you can still
                  save it.
                </p>
              )}
            </AppFormField>
          </>
        )}
      </FormSection>

      <FormSection
        title="Licensing & tax"
        description="We verify these before your clinic goes live. Numbers are checked for format here; our team confirms them during review."
      >
        <div className="space-y-2 md:col-span-2">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" {...register('noNpi')} />
            <span>
              I don&apos;t have an NPI number
              <span className="block text-xs text-slate-500">
                You can continue without one: our team confirms your state license instead during
                review.
              </span>
            </span>
          </label>
        </div>
        {!v.noNpi && (
          <AppFormField label="Group NPI #" required error={err('groupNpi')} htmlFor="groupNpi">
            <AppInput
              id="groupNpi"
              inputMode="numeric"
              placeholder="10 digits"
              {...register('groupNpi')}
            />
            <IdCheck value={v.groupNpi ?? ''} valid={isValidNpi(v.groupNpi ?? '')} label="NPI" />
            <NpiRegistryCheck
              npi={v.groupNpi ?? ''}
              expect={2}
              idPrefix="group"
              reason={String(v.groupNpiOverrideReason ?? '')}
              onReasonChange={(r) => setValue('groupNpiOverrideReason', r)}
            />
          </AppFormField>
        )}
        <AppFormField
          label="Federal Tax ID (EIN)"
          required={!masked}
          error={err('federalTaxId')}
          htmlFor="federalTaxId"
          description={masked ? `On file: ${masked}. Leave blank to keep it.` : undefined}
        >
          <AppInput
            id="federalTaxId"
            placeholder="12-3456789"
            autoComplete="off"
            {...register('federalTaxId')}
          />
          <IdCheck
            value={v.federalTaxId ?? ''}
            valid={isValidEin(v.federalTaxId ?? '')}
            label="EIN"
          />
        </AppFormField>
        <AppFormField label="State license #" error={err('licenseNumber')} htmlFor="licenseNumber">
          <AppInput id="licenseNumber" {...register('licenseNumber')} />
        </AppFormField>
        <AppFormField label="License state" error={err('licenseState')} htmlFor="licenseState">
          <select id="licenseState" className={selectClass} {...register('licenseState')}>
            <option value="">Choose…</option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </AppFormField>
        <AppFormField
          label="DEA #"
          error={err('deaNumber')}
          htmlFor="deaNumber"
          description={
            deaMasked && !v.removeDea
              ? `On file: ${deaMasked}. Leave blank to keep it.`
              : 'Only if the practice prescribes controlled substances.'
          }
        >
          <AppInput
            id="deaNumber"
            placeholder="AB1234563"
            autoComplete="off"
            disabled={v.removeDea}
            {...register('deaNumber')}
          />
          <IdCheck value={v.deaNumber ?? ''} valid={isValidDea(v.deaNumber ?? '')} label="DEA" />
          {deaMasked && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" {...register('removeDea')} />
              Remove the DEA number on file
            </label>
          )}
        </AppFormField>
      </FormSection>

      <FormSection title="Your account">
        <AppFormField
          label="Estimated team size"
          required
          error={err('estimatedSeats')}
          htmlFor="estimatedSeats"
          descriptionBelow
          description="Just you? Enter 1. Otherwise count everyone who will sign in."
        >
          <AppInput
            id="estimatedSeats"
            type="number"
            min={1}
            max={1000}
            // CTO-09: selecting the pre-filled 1 on focus means typing replaces
            // it, instead of turning "1" into "13".
            onFocus={(e) => e.currentTarget.select()}
            {...register('estimatedSeats', { valueAsNumber: true })}
          />
        </AppFormField>
        <AppFormField
          label="How did you hear about us?"
          error={err('referralSource')}
          htmlFor="referralSource"
          descriptionBelow
          description="Optional."
        >
          <AppInput id="referralSource" {...register('referralSource')} />
        </AppFormField>
      </FormSection>

      {serverError && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {serverError}
        </p>
      )}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-rose-600">
          Some fields need attention. See the messages above.
        </p>
      )}

      <div className="flex justify-end border-t border-slate-100 pt-6">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
