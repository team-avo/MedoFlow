import { z } from 'zod'
import { IANAZone } from 'luxon'
import { isValidNpi, normalizeNpi, US_STATE_CODES, US_ZIP } from '../utils/practiceIds'

const cuidSchema = z.string().min(1, 'ID is required')

const emailSchema = z
  .string()
  .trim()
  .email('Valid email is required')
  .transform((value) => value.toLowerCase())

/**
 * A patient's phone number as typed: digits with the usual separators and an
 * optional leading +. 7–15 digits (E.164 allows at most 15).
 */
export const phoneSchema = z
  .string()
  .trim()
  .max(32, 'Phone number is too long')
  .regex(/^\+?[0-9 ().-]+$/, 'Enter a valid phone number')
  .refine((v) => {
    const digits = v.replace(/\D/g, '').length
    return digits >= 7 && digits <= 15
  }, 'Enter a valid phone number')

const optionalPriceOverride = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) {
    return undefined
  }
  return value
}, z.coerce.number().min(0, 'Price override must be 0 or greater').optional())

export const patientRegistrationSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Name is required'),
    email: emailSchema,
    password: z.string().min(6, 'Password must be at least 6 characters'),
    // Optional: auto-filled into bookings so the patient never re-types it.
    phone: z.preprocess((v) => (v === '' ? undefined : v), phoneSchema.optional()),
    // Optional. Carried through from the clinic page (`/clinic/[idOrSlug]`)
    // so a new patient is auto-linked to that clinic. Backend resolves
    // slug → cuid and falls back to null if unknown.
    clinicId: z.string().optional().nullable(),
  }),
}

export const clinicSetupSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Clinic name is required'),
    email: emailSchema,
    location: z.object({
      id: cuidSchema.optional(),
      name: z.string().trim().min(1, 'Location name is required'),
      address: z.string().trim().optional(),
      timezone: z.string().trim().min(1, 'Timezone is required'),
    }),
  }),
}

export const clinicUpdateSchema = {
  body: z
    .object({
      name: z.string().trim().min(1, 'Clinic name is required').optional(),
      email: emailSchema.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field must be provided',
    }),
}

export const generateWebsiteSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Clinic name is required'),
    // Logo can be a hosted https URL OR an inline data: URL (for the
    // demo's drag-drop upload path which doesn't need an S3 bucket).
    logoUrl: z
      .string()
      .trim()
      .refine((v) => v === '' || v.startsWith('data:image/') || /^https?:\/\//i.test(v), {
        message: 'Logo must be a valid image URL or upload',
      })
      .optional(),
    themeColor: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Theme color must be a hex code like #14B8A6')
      .optional()
      .or(z.literal('')),
  }),
}

export const locationUpsertSchema = {
  body: z.object({
    id: cuidSchema.optional(),
    name: z.string().trim().min(1, 'Location name is required'),
    address: z.string().trim().optional(),
    addressLine1: z.string().trim().optional(),
    addressLine2: z.string().trim().optional(),
    city: z.string().trim().optional(),
    // CTO-22: US addresses. Blank is fine; a value must be a US state or
    // territory, and a ZIP or ZIP+4 (same rules as the clinic application).
    state: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || US_STATE_CODES.includes(v.toUpperCase()), 'Choose a US state')
      .transform((v) => (v ? v.toUpperCase() : v)),
    postalCode: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || US_ZIP.test(v), 'Enter a 5-digit ZIP or ZIP+4'),
    country: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    timezone: z
      .string()
      .trim()
      .min(1, 'Timezone is required')
      .refine((tz) => IANAZone.isValidZone(tz), 'Choose a timezone'),
  }),
}

/** PATCH /locations/:id — every field optional; whatever is sent is updated. */
export const locationPatchSchema = {
  params: z.object({ id: cuidSchema }),
  body: locationUpsertSchema.body.omit({ id: true }).extend({
    name: z.string().trim().min(1, 'Location name is required').optional(),
    timezone: z
      .string()
      .trim()
      .min(1, 'Timezone is required')
      .refine((tz) => IANAZone.isValidZone(tz), 'Choose a timezone')
      .optional(),
  }),
}

export const disciplineCreateSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Name is required'),
    description: z.string().trim().optional(),
  }),
}

export const disciplineUpdateSchema = {
  params: z.object({
    id: cuidSchema,
  }),
  body: z
    .object({
      name: z.string().trim().min(1, 'Name is required').optional(),
      description: z.string().trim().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field must be provided',
    }),
}

export const serviceCreateSchema = {
  body: z.object({
    disciplineId: cuidSchema,
    name: z.string().trim().min(1, 'Name is required'),
    duration: z.coerce.number().int().min(1, 'Duration must be at least 1 minute'),
    defaultPrice: z.coerce.number().min(0, 'Default price must be 0 or greater'),
    taxApplicable: z.boolean().optional(),
    /** CTO-31: the visit type a new booking starts with. */
    defaultMode: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
  }),
}

export const serviceUpdateSchema = {
  params: z.object({
    id: cuidSchema,
  }),
  body: z
    .object({
      disciplineId: cuidSchema.optional(),
      name: z.string().trim().min(1, 'Name is required').optional(),
      duration: z.coerce.number().int().min(1, 'Duration must be at least 1 minute').optional(),
      defaultPrice: z.coerce.number().min(0, 'Default price must be 0 or greater').optional(),
      taxApplicable: z.boolean().optional(),
      defaultMode: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field must be provided',
    }),
}

export const providerCreateSchema = {
  body: z.object({
    firstName: z.string().trim().min(1, 'First name is required'),
    lastName: z.string().trim().min(1, 'Last name is required'),
    email: emailSchema,
    phone: z.string().trim().optional(),
    disciplineIds: z.array(cuidSchema).min(1, 'At least one discipline is required'),
    locationIds: z.array(cuidSchema).optional(),
    services: z
      .array(
        z.object({
          serviceId: cuidSchema,
          priceOverride: optionalPriceOverride,
        })
      )
      .min(1, 'At least one service is required'),
    // Optional credentials (prefilled from the clinic application).
    npi: z
      .preprocess((v) => (v === null ? '' : v), z.string().trim().optional())
      .refine((v) => !v || isValidNpi(v), 'Enter a valid 10-digit NPI')
      .transform((v) => (v === undefined ? undefined : v ? normalizeNpi(v) : null)),
    licenseNumber: z.string().trim().max(50).nullable().optional(),
    licenseState: z
      .preprocess((v) => (v === null ? '' : v), z.string().trim().optional())
      .refine((v) => !v || US_STATE_CODES.includes(v.toUpperCase()), 'Choose a US state')
      .transform((v) => (v === undefined ? undefined : v ? v.toUpperCase() : null)),
    credentials: z.string().trim().max(30).nullable().optional(),
  }),
}

export const providerUpdateSchema = {
  params: z.object({
    id: cuidSchema,
  }),
  body: z
    .object({
      firstName: z.string().trim().min(1, 'First name is required').optional(),
      lastName: z.string().trim().min(1, 'Last name is required').optional(),
      email: emailSchema.optional(),
      phone: z.string().trim().optional(),
      disciplineIds: z.array(cuidSchema).min(1).optional(),
      locationIds: z.array(cuidSchema).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field must be provided',
    }),
}

export const providerServiceCreateSchema = {
  params: z.object({
    id: cuidSchema,
  }),
  body: z.object({
    serviceId: cuidSchema,
    priceOverride: optionalPriceOverride,
  }),
}

export const providerServiceUpdateSchema = {
  params: z.object({
    id: cuidSchema,
    serviceId: cuidSchema,
  }),
  body: z.object({
    priceOverride: optionalPriceOverride,
  }),
}

export const frontDeskProvisionSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Name is required'),
    email: emailSchema,
  }),
}
