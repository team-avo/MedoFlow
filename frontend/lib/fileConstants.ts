/**
 * Patient-file upload policy — mirrors backend/src/config/fileConstants.ts
 * (B3.1). Checked in the browser before a presigned URL is even requested;
 * the API re-checks everything, including the file's actual bytes.
 */
export const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
] as const

export const FILE_SIZE_LIMIT_MB = 10
export const FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_MB * 1024 * 1024

/** For the <input type="file" accept> attribute. */
export const FILE_ACCEPT = ALLOWED_FILE_TYPES.join(',')

/** Types the in-app viewer may render (everything else is download-only). */
export const PREVIEWABLE_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
] as const

export const isPreviewable = (mime: string): boolean =>
  (PREVIEWABLE_FILE_TYPES as readonly string[]).includes(mime.toLowerCase())

/** Why a file cannot be uploaded, or null when it can. Never echoes the filename. */
export function fileUploadProblem(file: { type: string; size: number }): string | null {
  if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(file.type.toLowerCase())) {
    return 'This file type is not allowed. Upload a PDF, image (JPEG, PNG, GIF, WebP), or text/CSV file.'
  }
  if (file.size <= 0) return 'The file is empty.'
  if (file.size > FILE_SIZE_LIMIT_BYTES) {
    return `The file is larger than ${FILE_SIZE_LIMIT_MB} MB.`
  }
  return null
}
