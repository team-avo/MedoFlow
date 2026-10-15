import { z } from 'zod'

const cuidSchema = z.string().min(1, 'ID is required')
const isoStringSchema = z
  .string()
  .refine((s) => !isNaN(Date.parse(s)), { message: 'Valid ISO datetime is required' })
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid date (YYYY-MM-DD) is required')

export const publicAvailabilitySchema = {
  query: z.object({
    clinicId: cuidSchema,
    serviceId: cuidSchema,
    providerId: cuidSchema.optional(),
    locationId: cuidSchema.optional(),
    date: dateStringSchema,
  }),
}

export const publicAvailabilityQuerySchema = publicAvailabilitySchema

export const publicSlotHoldSchema = {
  body: z.object({
    clinicId: cuidSchema,
    providerId: cuidSchema,
    serviceId: cuidSchema,
    locationId: cuidSchema.optional(),
    timezone: z.string().min(1, 'Timezone is required'),
    startTime: isoStringSchema,
    endTime: isoStringSchema,
    patientId: cuidSchema.optional(),
  }),
}

export const slotHoldCreateSchema = publicSlotHoldSchema

export const appointmentCreateSchema = {
  body: z.object({
    clinicId: cuidSchema.optional(),
    locationId: cuidSchema.optional(),
    providerId: cuidSchema,
    serviceId: cuidSchema,
    patientId: cuidSchema.optional(),
    startTime: isoStringSchema,
    endTime: isoStringSchema,
    slotHoldId: cuidSchema.optional(),
    /**
     * Patient opted in to AI Scribe while booking. When true, the session
     * created later will start with consent granted so the provider isn't
     * prompted to re-confirm mid-visit.
     */
    aiScribeConsent: z.boolean().optional(),
  }),
}

export const recurringAppointmentCreateSchema = {
  body: z.object({
    clinicId: cuidSchema.optional(),
    locationId: cuidSchema.optional(),
    providerId: cuidSchema,
    serviceId: cuidSchema,
    patientId: cuidSchema.optional(),
    startTime: isoStringSchema,
    endTime: isoStringSchema,
    frequency: z.literal('WEEKLY'),
    numberOfSessions: z.coerce.number().int().min(2).max(52).optional(),
    endDate: dateStringSchema.optional().nullable(),
  }),
}

export const appointmentRecurringSchema = recurringAppointmentCreateSchema

export const appointmentRescheduleSchema = {
  params: z.object({
    id: cuidSchema,
  }),
  body: z.object({
    locationId: cuidSchema.optional(),
    slotHoldId: cuidSchema.optional(),
    newStartTime: isoStringSchema,
    newEndTime: isoStringSchema,
  }),
}

export const appointmentSeriesCancelSchema = {
  params: z.object({
    seriesId: cuidSchema,
  }),
  body: z
    .object({
      reason: z.string().max(500).optional(),
    })
    .optional(),
}

export const waitlistCreateSchema = {
  body: z.object({
    clinicId: cuidSchema,
    providerId: cuidSchema,
    serviceId: cuidSchema,
    locationId: cuidSchema.optional(),
    timezone: z.string().optional(),
    preferredDate: dateStringSchema,
    preferredStartTime: z.string().min(1, 'Preferred start time is required'),
    preferredEndTime: z.string().min(1, 'Preferred end time is required'),
    patientId: cuidSchema.optional(),
  }),
}
