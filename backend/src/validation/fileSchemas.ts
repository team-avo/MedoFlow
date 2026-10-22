import { z } from 'zod'
import { FILE_SIZE_LIMIT_BYTES, MIME_WHITELIST } from '../config/fileConstants'

const id = z.string().trim().min(1).max(64)

/** POST /files/uploads — request a presigned upload (B3.1). */
export const createUploadIntentSchema = z
  .object({
    patientId: id,
    visitRecordId: id.optional().nullable(),
    fileName: z
      .string()
      .trim()
      .min(1, 'fileName is required')
      .max(255, 'fileName must be at most 255 characters')
      .refine((n) => !/[\\/\u0000-\u001f]/.test(n), 'fileName must not contain path separators'),
    mimeType: z
      .string()
      .trim()
      .toLowerCase()
      .refine((m) => (MIME_WHITELIST as readonly string[]).includes(m), 'File type not allowed'),
    size: z
      .number()
      .int()
      .positive('File is empty')
      .max(FILE_SIZE_LIMIT_BYTES, 'File is larger than the upload limit'),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  })
  .strict()

export const fileIdParamsSchema = z.object({ id })
export const patientIdParamsSchema = z.object({ patientId: id })
export const patientClinicQuerySchema = z.object({ clinicId: id.optional() }).passthrough()
