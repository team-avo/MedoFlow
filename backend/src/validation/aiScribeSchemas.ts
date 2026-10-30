import { z } from 'zod'

/** Request schemas for /ai-scribe (FR-16): every write is validated and bounded. */

const id = z.string().trim().min(1).max(64)
const section = z.string().max(20_000, 'A note section can be at most 20,000 characters')
const summaryText = z.string().max(5_000, 'A summary field can be at most 5,000 characters')

export const sessionIdParamSchema = z.object({ id }).strict()
export const visitRecordIdParamSchema = z.object({ visitRecordId: id }).strict()

/** POST /ai-scribe/session/start */
export const startSessionSchema = z.object({ visitRecordId: id, clinicId: id.optional() }).strict()

export const soapEditSchema = z
  .object({
    subjective: section.optional(),
    objective: section.optional(),
    assessment: section.optional(),
    plan: section.optional(),
  })
  .strict()

export const patientSummaryEditSchema = z
  .object({
    diagnosis: summaryText.optional(),
    treatmentPlan: summaryText.optional(),
    nextSteps: summaryText.optional(),
  })
  .strict()

/** PUT /ai-scribe/session/:id/draft — the provider's edits to the note and the patient summary. */
export const updateDraftSchema = soapEditSchema
  .extend({ clinicId: id.optional(), patientSummary: patientSummaryEditSchema.optional() })
  .strict()

/**
 * POST /ai-scribe/session/:id/consent — the provider attests the patient gave
 * verbal consent (in-person visits). Both fields must be exactly these values.
 */
export const attestConsentSchema = z
  .object({
    method: z.literal('VERBAL', { message: 'Only verbal consent can be attested' }),
    acknowledged: z.literal(true, { message: 'Confirm that the patient consented' }),
    clinicId: id.optional(),
  })
  .strict()

/** Bodies that carry nothing but the optional clinic hint (process, regenerate, simulate, publish). */
export const emptyBodySchema = z.object({ clinicId: id.optional() }).strict().optional()
