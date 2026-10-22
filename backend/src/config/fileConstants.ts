/**
 * Patient-file upload policy (B3.1). The allow-list is matched exactly: no
 * `image/*` or `text/*` wildcards, so `image/svg+xml` and `text/html` (both
 * script-capable when rendered by a browser) are refused. Keep in sync with
 * frontend/lib/fileConstants.ts.
 */
export const MIME_WHITELIST = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
] as const

export type AllowedMime = (typeof MIME_WHITELIST)[number]

export const FILE_SIZE_LIMIT_MB = parseInt(process.env.FILE_SIZE_LIMIT_MB || '10', 10)
export const FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_MB * 1024 * 1024

export const isMimeAllowed = (mime: string): mime is AllowedMime =>
  (MIME_WHITELIST as readonly string[]).includes(mime.toLowerCase())

/** Presigned URL lifetime: default 5 minutes, never more than 15. */
export const FILE_URL_TTL_MAX_SECONDS = 900
export const getFileUrlTtlSeconds = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = parseInt(env.FILE_URL_TTL_SECONDS || '300', 10)
  if (!Number.isFinite(n) || n <= 0) return 300
  return Math.min(n, FILE_URL_TTL_MAX_SECONDS)
}

/** A PENDING upload that was never completed is swept after this long. */
export const PENDING_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000
