/**
 * Client-side validation for the clinic application forms: the mirror of
 * backend/src/validation/onboardingSchemas.ts. The NPI / EIN / DEA checks are
 * the same functions on both sides (lib/practiceIds.ts, shared test cases in
 * shared/validation-cases/practice-ids.json); the API re-validates everything.
 */
import { z } from 'zod'
import {
  isValidDea,
  isValidEin,
  isValidNpi,
  isValidPracticeTypeOther,
  PRACTITIONER_TITLES,
  US_STATE_CODES,
  US_ZIP,
} from '@/lib/practiceIds'
import type { Application, PracticeDetailsPayload, Practitioner } from '@/lib/onboardingApi'

const PHONE = /^[+()\d\s.-]{7,25}$/
// CTO-22: same ZIP rule as the backend (shared/validation-cases/practice-lists.json).
const ZIP = US_ZIP
const ZIP_MESSAGE = 'Enter a 5-digit ZIP or ZIP+4'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const text = z.string().trim()
const required = (label: string, max = 200) =>
  text.min(2, `${label} is required`).max(max, `${label} is too long`)
const optional = (max: number) => text.max(max, 'Too long')
const optionalPhone = text.refine((v) => !v || PHONE.test(v), 'Enter a valid phone number')
const optionalEmail = text.refine((v) => !v || EMAIL.test(v), 'Enter a valid email')
const state = text.refine((v) => US_STATE_CODES.includes(v.toUpperCase()), 'Choose a state')
const optionalState = text.refine(
  (v) => !v || US_STATE_CODES.includes(v.toUpperCase()),
  'Choose a state'
)
const optionalNpi = text.refine((v) => !v || isValidNpi(v), 'Enter a valid 10-digit NPI')

export const practiceFormSchema = z
  .object({
    legalName: required('Legal name of practice'),
    sameAsLegal: z.boolean(),
    dbaName: optional(200),
    practiceType: text.min(1, 'Choose a practice type'),
    /** CTO-18: required (2 to 80 characters) when practiceType is OTHER. */
    practiceTypeOther: optional(80),
    locationCount: z
      .number({ message: 'Enter a number' })
      .int('Enter a whole number')
      .min(1, 'At least 1')
      .max(500, 'Up to 500'),

    addressLine1: required('Street address'),
    addressLine2: optional(200),
    city: required('City', 100),
    state,
    postalCode: text.regex(ZIP, ZIP_MESSAGE),
    timezone: text.min(1, 'Choose a timezone'),
    officePhone: optionalPhone,
    fax: optionalPhone,
    website: optional(200),

    primaryContactName: required('Primary contact name'),
    primaryContactEmail: text.regex(EMAIL, 'Enter a valid email'),
    primaryContactPhone: optionalPhone,
    // CTO-17: one optional secondary contact.
    secondaryContactName: optional(200),
    secondaryContactEmail: optionalEmail,
    secondaryContactPhone: optionalPhone,

    mailingSameAsPrimary: z.boolean(),
    mailingAddressLine1: optional(200),
    mailingAddressLine2: optional(200),
    mailingCity: optional(100),
    mailingState: optionalState,
    mailingPostalCode: text.refine((v) => !v || ZIP.test(v), ZIP_MESSAGE),

    noNpi: z.boolean(),
    groupNpi: optionalNpi,
    /** Blank on an edit = keep the number on file. */
    federalTaxId: text.refine((v) => !v || isValidEin(v), 'Enter a valid EIN (NN-NNNNNNN)'),
    hasTaxIdOnFile: z.boolean(),
    licenseNumber: optional(50),
    licenseState: optionalState,
    /** Blank on an edit = keep; `removeDea` clears it. */
    deaNumber: text.refine(
      (v) => !v || isValidDea(v),
      'Enter a valid DEA number (2 letters + 7 digits)'
    ),
    hasDeaOnFile: z.boolean(),
    removeDea: z.boolean(),

    estimatedSeats: z
      .number({ message: 'Enter a number' })
      .int('Enter a whole number')
      .min(1, 'At least 1')
      .max(1000, 'Up to 1000'),
    referralSource: optional(200),
  })
  .superRefine((v, ctx) => {
    if (v.practiceType === 'OTHER' && !isValidPracticeTypeOther(v.practiceTypeOther)) {
      ctx.addIssue({
        code: 'custom',
        path: ['practiceTypeOther'],
        message: 'Type your practice type (2 to 80 characters)',
      })
    }
    if (!v.noNpi && !v.groupNpi) {
      ctx.addIssue({
        code: 'custom',
        path: ['groupNpi'],
        message: 'Enter your group NPI, or tick "I don\'t have an NPI"',
      })
    }
    if (!v.hasTaxIdOnFile && !v.federalTaxId) {
      ctx.addIssue({
        code: 'custom',
        path: ['federalTaxId'],
        message: 'Federal Tax ID is required',
      })
    }
    if (!v.sameAsLegal && !v.dbaName) {
      ctx.addIssue({ code: 'custom', path: ['dbaName'], message: 'Enter the practice name (DBA)' })
    }
    if (!v.mailingSameAsPrimary) {
      for (const [key, label] of [
        ['mailingAddressLine1', 'Mailing street address'],
        ['mailingCity', 'Mailing city'],
        ['mailingState', 'Mailing state'],
        ['mailingPostalCode', 'Mailing ZIP code'],
      ] as const) {
        if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${label} is required` })
      }
    }
  })

export type PracticeFormValues = z.input<typeof practiceFormSchema>

const orNull = (v: string | undefined) => (v && v.trim() ? v.trim() : null)

/** Form defaults from what is on file (or the signed-in owner, on a first visit). */
export function practiceFormDefaults(
  app: Application | null,
  owner: { name?: string; email?: string } = {}
): PracticeFormValues {
  const p = app?.profile
  const l = app?.location
  return {
    legalName: p?.legalName ?? '',
    sameAsLegal: !p?.dbaName,
    dbaName: p?.dbaName ?? '',
    practiceType: p?.practiceType ?? '',
    practiceTypeOther: p?.practiceTypeOther ?? '',
    locationCount: p?.locationCount ?? 1,
    addressLine1: l?.addressLine1 ?? '',
    addressLine2: l?.addressLine2 ?? '',
    city: l?.city ?? '',
    state: l?.state ?? '',
    postalCode: l?.postalCode ?? '',
    timezone: l?.timezone && l.timezone !== 'UTC' ? l.timezone : 'America/New_York',
    officePhone: p?.officePhone ?? l?.phone ?? '',
    fax: p?.fax ?? '',
    website: p?.website ?? '',
    primaryContactName: p?.primaryContactName ?? owner.name ?? '',
    primaryContactEmail: p?.primaryContactEmail ?? owner.email ?? '',
    primaryContactPhone: p?.primaryContactPhone ?? '',
    secondaryContactName: p?.secondaryContactName ?? '',
    secondaryContactEmail: p?.secondaryContactEmail ?? '',
    secondaryContactPhone: p?.secondaryContactPhone ?? '',
    mailingSameAsPrimary: p?.mailingSameAsPrimary ?? true,
    mailingAddressLine1: p?.mailingAddressLine1 ?? '',
    mailingAddressLine2: p?.mailingAddressLine2 ?? '',
    mailingCity: p?.mailingCity ?? '',
    mailingState: p?.mailingState ?? '',
    mailingPostalCode: p?.mailingPostalCode ?? '',
    noNpi: p?.noNpi ?? false,
    groupNpi: p?.groupNpi ?? '',
    federalTaxId: '',
    hasTaxIdOnFile: Boolean(p?.federalTaxIdMasked),
    licenseNumber: p?.licenseNumber ?? '',
    licenseState: p?.licenseState ?? '',
    deaNumber: '',
    hasDeaOnFile: Boolean(p?.hasDeaNumber),
    removeDea: false,
    estimatedSeats: p?.estimatedSeats ?? 1,
    referralSource: p?.referralSource ?? '',
  }
}

/** Form values → the API body. */
export function toPracticePayload(v: PracticeFormValues): PracticeDetailsPayload {
  const s = (x: unknown) => String(x ?? '').trim()
  return {
    legalName: s(v.legalName),
    dbaName: v.sameAsLegal ? null : orNull(v.dbaName),
    practiceType: s(v.practiceType),
    practiceTypeOther: s(v.practiceType) === 'OTHER' ? orNull(v.practiceTypeOther) : null,
    locationCount: Number(v.locationCount),
    addressLine1: s(v.addressLine1),
    addressLine2: orNull(v.addressLine2),
    city: s(v.city),
    state: s(v.state).toUpperCase(),
    postalCode: s(v.postalCode),
    timezone: s(v.timezone),
    officePhone: orNull(v.officePhone),
    fax: orNull(v.fax),
    website: orNull(v.website),
    primaryContactName: s(v.primaryContactName),
    primaryContactEmail: s(v.primaryContactEmail),
    primaryContactPhone: orNull(v.primaryContactPhone),
    secondaryContactName: orNull(v.secondaryContactName),
    secondaryContactEmail: orNull(v.secondaryContactEmail),
    secondaryContactPhone: orNull(v.secondaryContactPhone),
    mailingSameAsPrimary: v.mailingSameAsPrimary,
    mailingAddressLine1: v.mailingSameAsPrimary ? null : orNull(v.mailingAddressLine1),
    mailingAddressLine2: v.mailingSameAsPrimary ? null : orNull(v.mailingAddressLine2),
    mailingCity: v.mailingSameAsPrimary ? null : orNull(v.mailingCity),
    mailingState: v.mailingSameAsPrimary ? null : (orNull(v.mailingState)?.toUpperCase() ?? null),
    mailingPostalCode: v.mailingSameAsPrimary ? null : orNull(v.mailingPostalCode),
    noNpi: v.noNpi,
    groupNpi: v.noNpi ? null : orNull(v.groupNpi),
    ...(s(v.federalTaxId) ? { federalTaxId: s(v.federalTaxId) } : {}),
    licenseNumber: orNull(v.licenseNumber),
    licenseState: orNull(v.licenseState)?.toUpperCase() ?? null,
    ...(v.removeDea ? { deaNumber: null } : s(v.deaNumber) ? { deaNumber: s(v.deaNumber) } : {}),
    estimatedSeats: Number(v.estimatedSeats),
    referralSource: orNull(v.referralSource),
  }
}

// ─── Practitioners ──────────────────────────────────────────────────────────

export interface PractitionerDraft {
  name: string
  email: string
  phone: string
  credentials: string
  licenseNumber: string
  licenseState: string
  npi: string
  /** A PRACTITIONER_TITLES value; '' = not given. */
  title: string
  /** Free text when title is 'Other'. */
  titleOther: string
  isOwner: boolean
  isSelf: boolean
  /** The owner's own row: they see patients (gets a provider profile). */
  seesPatients: boolean
}

export const emptyPractitioner = (): PractitionerDraft => ({
  name: '',
  email: '',
  phone: '',
  credentials: '',
  licenseNumber: '',
  licenseState: '',
  npi: '',
  title: '',
  titleOther: '',
  isOwner: false,
  isSelf: false,
  seesPatients: true,
})

/** Splits a stored title into the select value and the "Other" text. */
export function splitTitle(title: string | null | undefined): {
  title: string
  titleOther: string
} {
  const t = (title ?? '').trim()
  if (!t) return { title: '', titleOther: '' }
  if ((PRACTITIONER_TITLES as readonly string[]).includes(t) && t !== 'Other')
    return { title: t, titleOther: '' }
  return { title: 'Other', titleOther: t === 'Other' ? '' : t }
}

/** The title to store: the select value, or the typed text for "Other". */
export function joinTitle(title: string, titleOther: string): string | null {
  if (!title) return null
  if (title === 'Other') return titleOther.trim() || null
  return title
}

export type PractitionerErrors = Partial<Record<keyof PractitionerDraft, string>>

/**
 * Validates the practitioner list. Returns per-row field errors plus a list
 * error (owner on record, duplicates). `npiRequired` = the practice has a
 * group NPI, so every practitioner needs their own.
 */
export function validatePractitioners(
  list: PractitionerDraft[],
  npiRequired: boolean
): { rows: PractitionerErrors[]; list: string | null } {
  const seen = new Map<string, number>()
  const rows = list.map((p, i) => {
    const e: PractitionerErrors = {}
    if (p.name.trim().length < 2) e.name = 'Name is required'
    const email = p.email.trim().toLowerCase()
    if (!EMAIL.test(email)) e.email = 'Enter a valid email'
    else if (seen.has(email)) e.email = 'Each practitioner needs their own email'
    else seen.set(email, i)
    if (p.phone.trim() && !PHONE.test(p.phone.trim())) e.phone = 'Enter a valid phone number'
    if (p.licenseState && !US_STATE_CODES.includes(p.licenseState.toUpperCase()))
      e.licenseState = 'Choose a state'
    if (p.npi.trim() && !isValidNpi(p.npi)) e.npi = 'Enter a valid 10-digit NPI'
    else if (npiRequired && !p.npi.trim() && (!p.isSelf || p.seesPatients))
      e.npi = 'NPI is required'
    if (p.title === 'Other' && !p.titleOther.trim()) e.titleOther = 'Type your title'
    return e
  })
  let listError: string | null = null
  if (list.length === 0) listError = 'Add at least one practitioner'
  else if (list.filter((p) => p.isOwner).length !== 1)
    listError = 'Mark exactly one practitioner as the primary account holder'
  else if (list.filter((p) => p.isSelf).length > 1) listError = 'Only one practitioner can be you'
  return { rows, list: listError }
}

export const practitionersValid = (r: ReturnType<typeof validatePractitioners>) =>
  !r.list && r.rows.every((e) => Object.keys(e).length === 0)

export const toPractitionerDraft = (p: Practitioner): PractitionerDraft => ({
  name: p.name,
  email: p.email,
  phone: p.phone ?? '',
  credentials: p.credentials ?? '',
  licenseNumber: p.licenseNumber ?? '',
  licenseState: p.licenseState ?? '',
  npi: p.npi ?? '',
  ...splitTitle(p.title),
  isOwner: p.isOwner,
  isSelf: p.isSelf,
  seesPatients: p.seesPatients !== false,
})

export const toPractitionerPayload = (p: PractitionerDraft): Practitioner => ({
  name: p.name.trim(),
  email: p.email.trim().toLowerCase(),
  phone: orNull(p.phone),
  credentials: orNull(p.credentials),
  licenseNumber: orNull(p.licenseNumber),
  licenseState: orNull(p.licenseState)?.toUpperCase() ?? null,
  npi: orNull(p.npi)?.replace(/[\s-]/g, '') ?? null,
  title: joinTitle(p.title, p.titleOther),
  isOwner: p.isOwner,
  isSelf: p.isSelf,
  ...(p.isSelf ? { seesPatients: p.seesPatients } : {}),
})

// ─── Agreement ──────────────────────────────────────────────────────────────

/** The typed signature must match the printed name (case and spacing aside). */
export const signatureMatches = (signature: string, name: string) =>
  signature.trim().replace(/\s+/g, ' ').toLowerCase() ===
    name.trim().replace(/\s+/g, ' ').toLowerCase() && name.trim().length >= 2
