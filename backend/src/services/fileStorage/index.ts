import { createS3Client, isS3Configured, S3FileStorage } from './s3Driver'
import { LocalFileStorage } from './localDriver'
import type { FileStorageDriver } from './types'

export * from './types'
export { LocalFileStorage, UPLOAD_BASE, BLOB_ROUTE } from './localDriver'
export { S3FileStorage, isS3Configured, getSseMode, sseParams } from './s3Driver'

/** Bucket for patient files; falls back to the shared S3_BUCKET. */
export const patientFilesBucket = (env: NodeJS.ProcessEnv = process.env): string =>
  env.S3_FILES_BUCKET || env.S3_BUCKET || 'medoflow-files'

let override: FileStorageDriver | null = null
let local: LocalFileStorage | null = null
const s3ByBucket = new Map<string, S3FileStorage>()

const localDriver = (): LocalFileStorage => (local ??= new LocalFileStorage())

const s3Driver = (bucket: string): S3FileStorage => {
  let d = s3ByBucket.get(bucket)
  if (!d) {
    d = new S3FileStorage(createS3Client(), bucket)
    s3ByBucket.set(bucket, d)
  }
  return d
}

/**
 * The store new patient files are written to: object storage when
 * S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY are set, otherwise local disk
 * (development/CI only — production refuses to boot without object storage,
 * see config/envValidation.ts).
 */
export function getPatientFileStorage(): FileStorageDriver {
  if (override) return override
  return isS3Configured() ? s3Driver(patientFilesBucket()) : localDriver()
}

/**
 * Resolves a stored reference to its driver and key:
 *   s3:<bucket>:<key>   object storage
 *   local:<key>         local disk (dev/CI)
 *   <relative path>     legacy rows written by the old in-process upload
 */
export function resolveStorageRef(ref: string): { driver: FileStorageDriver; key: string } {
  if (override) {
    const key = ref.replace(/^(s3:[^:]*:|local:)/, '')
    return { driver: override, key }
  }
  if (ref.startsWith('s3:')) {
    const rest = ref.slice(3)
    const i = rest.indexOf(':')
    const bucket = i >= 0 ? rest.slice(0, i) : patientFilesBucket()
    const key = i >= 0 ? rest.slice(i + 1) : rest
    if (!isS3Configured()) throw new Error('Object storage is not configured')
    return { driver: s3Driver(bucket), key }
  }
  if (ref.startsWith('local:')) return { driver: localDriver(), key: ref.slice(6) }
  return { driver: localDriver(), key: ref.replace(/^\/+/, '') }
}

/** Test seam: route every storage call to a given driver (null restores). */
export function setFileStorageForTests(driver: FileStorageDriver | null): void {
  override = driver
}
