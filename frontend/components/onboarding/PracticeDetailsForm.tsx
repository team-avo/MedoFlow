'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { AppFormField, AppInput } from '@/components/ui-system'
import { apiErrorOf } from '@/lib/apiError'
import { onboardingApi, type Application } from '@/lib/onboardingApi'
import { isValidDea, isValidEin, isValidNpi, PRACTICE_TYPES, US_STATES } from '@/lib/practiceIds'
import {
  practiceFormDefaults,
  practiceFormSchema,
  toPracticePayload,
  type PracticeFormValues,
} from '@/lib/schemas/onboarding'
import { FormSection, IdCheck, selectClass, TIMEZONES } from './ApplicationShell'

/**
 * Practice details — the first step of the clinic application, and the
 * "Practice" tab of /dashboard/clinic. Field set: legal name / DBA, practice
 * type, locations, primary address (written to the main location), contacts,
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
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PracticeFormValues>({
    resolver: zodResolver(practiceFormSchema),
    defaultValues: practiceFormDefaults(application, owner),
  })

  const v = watch()
  const err = (k: keyof PracticeFormValues) => errors[k]?.message as string | undefined

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      const app = await onboardingApi.savePractice(toPracticePayload(values))
      await onSaved(app)
    } catch (e) {
      setServerError(apiErrorOf(e).message)
    }
  })

  const masked = application?.profile?.federalTaxIdMasked
  const deaMasked = application?.profile?.deaNumberMasked

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8" aria-label="Practice details">
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

      <FormSection
        title="Contacts"
        description="Who we talk to about the account, orders and billing."
      >
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
          label="Office manager"
          error={err('officeManagerName')}
          htmlFor="officeManagerName"
        >
          <AppInput id="officeManagerName" {...register('officeManagerName')} />
        </AppFormField>
        <AppFormField
          label="Office manager email"
          error={err('officeManagerEmail')}
          htmlFor="officeManagerEmail"
        >
          <AppInput id="officeManagerEmail" type="email" {...register('officeManagerEmail')} />
        </AppFormField>
        <AppFormField
          label="Accounts payable"
          error={err('accountsPayableName')}
          htmlFor="accountsPayableName"
        >
          <AppInput id="accountsPayableName" {...register('accountsPayableName')} />
        </AppFormField>
        <AppFormField
          label="Accounts payable email"
          error={err('accountsPayableEmail')}
          htmlFor="accountsPayableEmail"
        >
          <AppInput id="accountsPayableEmail" type="email" {...register('accountsPayableEmail')} />
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
                You can continue without one — our team confirms your state license instead during
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
            <option value="">—</option>
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
          description="Practitioners, front desk and admins combined."
        >
          <AppInput
            id="estimatedSeats"
            type="number"
            min={1}
            max={1000}
            {...register('estimatedSeats', { valueAsNumber: true })}
          />
        </AppFormField>
        <AppFormField
          label="How did you hear about us?"
          error={err('referralSource')}
          htmlFor="referralSource"
        >
          <AppInput id="referralSource" {...register('referralSource')} />
        </AppFormField>
        <AppFormField label="Sales rep (if any)" error={err('salesRep')} htmlFor="salesRep">
          <AppInput id="salesRep" {...register('salesRep')} />
        </AppFormField>
      </FormSection>

      {serverError && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {serverError}
        </p>
      )}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-rose-600">
          Some fields need attention — see the messages above.
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
